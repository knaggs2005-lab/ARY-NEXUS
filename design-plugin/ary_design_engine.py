"""Fixed Cinema 4D operations. No eval, exec, macros, user scripts or menu IDs."""
import hashlib
import json
import math
import os
import time
import uuid

VERBS = {"open_document", "select_object", "create_object", "modify_dimensions", "change_property", "export", "save", "undo", "preview"}
FIELDS = {"open_document": {"path"}, "select_object": {"object_id"}, "create_object": {"kind", "name", "dimensions_mm"}, "modify_dimensions": {"object_id", "dimensions_mm"}, "change_property": {"object_id", "property", "rgb"}, "export": {"path", "format"}, "save": {"path"}, "undo": {"undo_token"}, "preview": {"mode"}}

class DesignEngine:
    def __init__(self, api, roots):
        self.c = api
        self.roots = [os.path.realpath(p) for p in roots]
        self.doc = None
        self.document_id = None
        self.undo = None
        self.undo_revision = None
        self.objects = {}

    def file(self, path, suffix, output=False):
        if not isinstance(path, str) or not os.path.isabs(path) or any(ord(x)<32 for x in path) or not path.lower().endswith(suffix):
            raise ValueError("Invalid design file name")
        canonical = os.path.realpath(path)
        if not any(os.path.commonpath([r, canonical]) == r and canonical != r for r in self.roots):
            raise ValueError("File is outside allowed design folders")
        if output:
            if os.path.lexists(path) or not os.path.isdir(os.path.dirname(canonical)):
                raise ValueError("Choose a new output file in an existing allowed folder")
        elif not os.path.isfile(canonical):
            raise ValueError("Design input must be an existing file")
        return canonical

    def factor(self, doc):
        c = self.c
        scale, unit = doc[c.DOCUMENT_DOCUNIT].GetUnitScale()
        units = {c.DOCUMENT_UNIT_MM:1, c.DOCUMENT_UNIT_CM:10, c.DOCUMENT_UNIT_M:1000, c.DOCUMENT_UNIT_INCH:25.4}
        factor = units.get(unit, 0) * scale
        return factor if math.isfinite(factor) and factor > 0 else None

    def inventory(self, doc):
        c = self.c
        objects, handles, dirty = [], {}, []
        complete, safe = True, True
        factor = self.factor(doc)
        def visit(obj, depth=0):
            nonlocal complete, safe
            while obj:
                if len(objects)>=200 or depth>20:
                    complete=False
                    return
                oid = str(obj.GetGUID())
                if oid in handles:
                    complete=False
                    return
                box = obj.CheckType(c.Ocube)
                supported = box or obj.CheckType(c.Onull)
                clean = not obj.GetTags() and obj.GetFirstCTrack() is None
                safe = safe and supported and clean
                scale = obj.GetRelScale()
                frozen = obj.GetFrozenScale()
                editable = box and clean and obj.GetUp() is None and all(abs(v-1)<1e-9 for v in (scale.x,scale.y,scale.z,frozen.x,frozen.y,frozen.z)) and factor is not None
                dims = obj[c.PRIM_CUBE_LEN] if box else None
                values = [dims.x*factor,dims.y*factor,dims.z*factor] if dims is not None and factor else None
                if values and any(not math.isfinite(v) or v<=0 or v>100000 for v in values):
                    values=None
                    editable=False
                objects.append({"id":oid,"name":obj.GetName(),"kind":"box" if box else "group" if supported else "unsupported", "dimensions_mm":values,"selected":bool(obj.GetBit(c.BIT_ACTIVE)),"editable":editable})
                handles[oid]=obj
                dirty.append([oid,obj.GetDirty(c.DIRTYFLAGS_ALL)])
                visit(obj.GetDown(),depth+1)
                obj=obj.GetNext()
        visit(doc.GetFirstObject())
        safe = safe and doc.GetFirstMaterial() is None and doc.GetFirstCTrack() is None
        return objects, handles, dirty, complete, safe, factor

    def scan(self):
        c = self.c
        doc=c.documents.GetActiveDocument()
        if doc != self.doc:
            self.doc=doc
            self.document_id=str(uuid.uuid4()) if doc else None
            self.undo=None
        objects, self.objects, dirty, complete, safe, factor = self.inventory(doc) if doc else ([],{},[],True,True,None)
        state={"adapter":"cinema4d","document_id":self.document_id,"document_name":doc.GetDocumentName() if doc else "", "document_path":os.path.join(doc.GetDocumentPath(),doc.GetDocumentName()) if doc and doc.GetDocumentPath() else "", "mm_per_unit":factor,"complete":complete,"safe_scene":safe,"export_formats":["obj"],"objects":objects}
        revision=hashlib.sha256(json.dumps([state,dirty,doc.GetDirty(c.DIRTYFLAGS_ALL) if doc else 0],sort_keys=True,allow_nan=False).encode()).hexdigest()
        if self.undo_revision != revision:
            self.undo=None
        return dict(state,revision=revision,undo_token=self.undo)

    @staticmethod
    def numbers(value, low, high):
        if not isinstance(value,list) or len(value)!=3 or any(type(v) not in (int,float) or not math.isfinite(v) or v<low or v>high for v in value):
            raise ValueError("Invalid numeric vector")
        return value

    def execute(self, job):
        changed=False
        before=None
        try:
            verb=job["verb"]
            if verb not in VERBS or time.time()*1000>job["deadline"]:
                raise ValueError("Invalid or expired design action")
            a=job["input"]["args"]
            if not isinstance(a,dict) or set(a)!=FIELDS[verb]:
                raise ValueError("Unknown design inputs; scripts and macros are not accepted")
            before=self.scan()
            if before["revision"]!=job["input"]["expected_revision"] or not before["complete"]:
                raise ValueError("Design state changed after review")
            doc,c=self.doc,self.c
            if verb!="open_document" and (not doc or not before["safe_scene"]):
                raise ValueError("Use a supported scene without scripts, tags, materials or animation")
            if verb not in ("open_document","save"):
                self.file(before["document_path"],".c4d")
            target=self.objects.get(a.get("object_id"))
            if "object_id" in a and target is None:
                raise ValueError("Object is no longer in this document")
            if verb in ("modify_dimensions","change_property") and not any(o["id"]==a["object_id"] and o["editable"] for o in before["objects"]):
                raise ValueError("Only unscaled top-level box primitives are editable")
            dims=None
            if "dimensions_mm" in a:
                dims=self.numbers(a["dimensions_mm"],0.000001,100000)
                if not before["mm_per_unit"]:
                    raise ValueError("Unknown document units")
            result={}
            if verb=="open_document":
                path=self.file(a["path"],".c4d")
                loaded=c.documents.LoadDocument(path,c.SCENEFILTER_OBJECTS|c.SCENEFILTER_MATERIALS|c.SCENEFILTER_IGNOREXREFS)
                if loaded is None: raise ValueError("Cinema 4D could not load this document")
                inv=self.inventory(loaded)
                if not inv[3] or not inv[4]: raise ValueError("Document contains unsupported content; it was not activated")
                changed=True
                c.documents.InsertBaseDocument(loaded)
                c.documents.SetActiveDocument(loaded)
            elif verb in ("create_object","modify_dimensions","change_property"):
                if verb=="create_object":
                    if a["kind"]!="box" or not isinstance(a["name"],str) or not 1<=len(a["name"])<=100 or any(ord(x)<32 for x in a["name"]):raise ValueError("Invalid object kind/name")
                    target=c.BaseObject(c.Ocube)
                    if target is None:raise ValueError("Box creation unavailable")
                    target.SetName(a["name"])
                    target[c.PRIM_CUBE_LEN]=c.Vector(*[v/before["mm_per_unit"] for v in dims])
                elif verb=="change_property":
                    if a["property"]!="display_color":raise ValueError("Unsupported property")
                    self.numbers(a["rgb"],0,1)
                if not doc.StartUndo():raise ValueError("Undo transaction unavailable")
                try:
                    if verb=="create_object":
                        changed=True
                        doc.InsertObject(target)
                        if not doc.AddUndo(c.UNDOTYPE_NEWOBJ,target):raise ValueError("Unable to record object undo")
                    else:
                        if not doc.AddUndo(c.UNDOTYPE_CHANGE,target):raise ValueError("Unable to record change undo")
                        changed=True
                        if verb=="modify_dimensions":target[c.PRIM_CUBE_LEN]=c.Vector(*[v/before["mm_per_unit"] for v in dims])
                        else:
                            target[c.ID_BASEOBJECT_USECOLOR]=c.ID_BASEOBJECT_USECOLOR_ALWAYS
                            target[c.ID_BASEOBJECT_COLOR]=c.Vector(*a["rgb"])
                finally:
                    if not doc.EndUndo():raise ValueError("Unable to finish undo transaction")
                result["object_id"]=str(target.GetGUID())
            elif verb=="select_object":
                changed=True
                doc.SetActiveObject(target,c.SELECTION_NEW)
            elif verb in ("save","export"):
                if verb=="export" and a["format"]!="obj":raise ValueError("STEP export is unsupported; no file was written")
                path=self.file(a["path"],".c4d" if verb=="save" else ".obj",True)
                if verb=="export" and os.path.lexists(path[:-4]+".mtl"):raise ValueError("Export material sidecar already exists")
                changed=True
                if not c.documents.SaveDocument(doc,path,c.SAVEDOCUMENTFLAGS_DONTADDTORECENTLIST,c.FORMAT_C4DEXPORT if verb=="save" else c.FORMAT_OBJ2EXPORT):raise ValueError("Cinema 4D did not confirm file output")
                if verb=="save":
                    doc.SetDocumentPath(os.path.dirname(path))
                    doc.SetDocumentName(os.path.basename(path))
                result["path"]=path
            elif verb=="undo":
                if not self.undo or a["undo_token"]!=self.undo:raise ValueError("Only the latest unchanged Ary edit can be undone")
                changed=True
                if not doc.DoUndo():raise ValueError("Undo failed")
            elif verb=="preview":
                if a["mode"]!="viewport":raise ValueError("Only viewport preview is supported")
                changed=True
                c.DrawViews(c.DRAWFLAGS_FORCEFULLREDRAW|c.DRAWFLAGS_ONLY_ACTIVE_VIEW)
                result["preview"]="viewport_redrawn"
                result["rendered_file"]=False
            c.EventAdd()
            self.undo=None
            after=self.scan()
            if verb in ("create_object","modify_dimensions","change_property"):
                self.undo=job["operation_id"]
                self.undo_revision=after["revision"]
                after["undo_token"]=self.undo
            return {"ok":True,"may_have_changed":changed,"error":None,"result":dict(result,before_revision=before["revision"],after_state=after)}
        except Exception as e:
            return {"ok":False,"may_have_changed":changed,"error":str(e)[:1500],"result":{"before_revision":before["revision"] if before else None}}
