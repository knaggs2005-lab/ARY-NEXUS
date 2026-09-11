"""Adapter unit tests against an injected Cinema 4D port, not live native acceptance."""
import copy
import importlib.util
import os
from pathlib import Path
import tempfile
import time
import unittest
import uuid
from types import SimpleNamespace

spec=importlib.util.spec_from_file_location("ary_design_engine",Path(__file__).parents[1]/"design-plugin/ary_design_engine.py")
engine_module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(engine_module)

class Vector:
    def __init__(self,x,y=None,z=None):self.x=x;self.y=x if y is None else y;self.z=x if z is None else z
class Object:
    next_id=0
    def __init__(self,kind):
        Object.next_id+=1;self.id=Object.next_id;self.kind=kind;self.name="Box";self.data={"PRIM_CUBE_LEN":Vector(1,1,1)};self.tags=[];self.track=None;self.dirty=0;self.scale=Vector(1);self.doc=None;self.selected=False
    def __getitem__(self,k):return self.data[k]
    def __setitem__(self,k,v):self.data[k]=v;self.dirty+=1
    def GetGUID(self):return self.id
    def GetName(self):return self.name
    def SetName(self,n):self.name=n;self.dirty+=1
    def CheckType(self,k):return self.kind==k
    def GetTags(self):return self.tags
    def GetFirstCTrack(self):return self.track
    def GetRelScale(self):return self.scale
    def GetFrozenScale(self):return Vector(1)
    def GetUp(self):return None
    def GetDown(self):return None
    def GetNext(self):
        i=self.doc.objects.index(self);return self.doc.objects[i+1] if i+1<len(self.doc.objects) else None
    def GetBit(self,k):return self.selected
    def GetDirty(self,k):return self.dirty
class Document:
    def __init__(self,path):self.path=path;self.name="fixture.c4d";self.objects=[];self.dirty=0;self.material=None;self.unit=(1,"DOCUMENT_UNIT_CM");self.undo=[]
    def __getitem__(self,k):return SimpleNamespace(GetUnitScale=lambda:self.unit)
    def GetFirstObject(self):return self.objects[0] if self.objects else None
    def GetFirstMaterial(self):return self.material
    def GetFirstCTrack(self):return None
    def GetDocumentPath(self):return self.path
    def GetDocumentName(self):return self.name
    def SetDocumentPath(self,p):self.path=p;self.dirty+=1
    def SetDocumentName(self,n):self.name=n;self.dirty+=1
    def GetDirty(self,k):return self.dirty
    def StartUndo(self):self.saved=copy.deepcopy(self.objects);return True
    def AddUndo(self,*args):return True
    def EndUndo(self):self.undo.append(self.saved);return True
    def InsertObject(self,obj):obj.doc=self;self.objects.append(obj);self.dirty+=1
    def SetActiveObject(self,obj,mode):
        for o in self.objects:o.selected=o==obj
        self.dirty+=1
    def DoUndo(self):
        if not self.undo:return False
        self.objects=self.undo.pop()
        for obj in self.objects:obj.doc=self
        self.dirty+=1;return True
class API:
    def __init__(self,doc):
        for key in ["DOCUMENT_DOCUNIT","DOCUMENT_UNIT_MM","DOCUMENT_UNIT_CM","DOCUMENT_UNIT_M","DOCUMENT_UNIT_INCH","Ocube","Onull","PRIM_CUBE_LEN","BIT_ACTIVE","DIRTYFLAGS_ALL","UNDOTYPE_NEWOBJ","UNDOTYPE_CHANGE","ID_BASEOBJECT_USECOLOR","ID_BASEOBJECT_USECOLOR_ALWAYS","ID_BASEOBJECT_COLOR","SELECTION_NEW","FORMAT_C4DEXPORT","FORMAT_OBJ2EXPORT"]:setattr(self,key,key)
        self.SCENEFILTER_OBJECTS=1;self.SCENEFILTER_MATERIALS=2;self.SCENEFILTER_IGNOREXREFS=4;self.SAVEDOCUMENTFLAGS_DONTADDTORECENTLIST=1;self.DRAWFLAGS_FORCEFULLREDRAW=1;self.DRAWFLAGS_ONLY_ACTIVE_VIEW=2
        self.active=doc;self.saved=[];self.previewed=False
        self.documents=SimpleNamespace(GetActiveDocument=lambda:self.active,LoadDocument=self.load,InsertBaseDocument=lambda d:None,SetActiveDocument=self.activate,SaveDocument=self.save)
        self.BaseObject=Object;self.Vector=Vector
    def load(self,p,flags):return Document(os.path.dirname(p))
    def activate(self,doc):self.active=doc
    def save(self,doc,path,flags,fmt):Path(path).write_text("fixture");self.saved.append((path,fmt));return True
    def DrawViews(self,flags):self.previewed=True
    def EventAdd(self):pass

class DesignTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=self.temp.name;Path(self.root,"fixture.c4d").write_text("fixture")
        self.doc=Document(self.root);self.api=API(self.doc);self.engine=engine_module.DesignEngine(self.api,[self.root])
    def tearDown(self):self.temp.cleanup()
    def run_action(self,verb,args,revision=None):
        state=self.engine.scan();return self.engine.execute({"operation_id":str(uuid.uuid4()),"verb":verb,"deadline":time.time()*1000+5000,"input":{"expected_revision":revision or state["revision"],"args":args}})
    def box(self):
        r=self.run_action("create_object",{"kind":"box","name":"Bracket","dimensions_mm":[50,20,10]});self.assertTrue(r["ok"],r);return r["result"]["object_id"]
    def test_units_and_dimension_edit(self):
        oid=self.box();self.assertEqual(self.doc.objects[0].data["PRIM_CUBE_LEN"].x,5)
        r=self.run_action("modify_dimensions",{"object_id":oid,"dimensions_mm":[60,20,10]});self.assertTrue(r["ok"],r);self.assertEqual(r["result"]["after_state"]["objects"][0]["dimensions_mm"],[60,20,10])
    def test_unknown_units_fail(self):
        self.doc.unit=(1,"unknown");r=self.run_action("create_object",{"kind":"box","name":"x","dimensions_mm":[1,1,1]});self.assertFalse(r["ok"]);self.assertFalse(r["may_have_changed"])
    def test_select_and_property(self):
        oid=self.box();self.assertTrue(self.run_action("select_object",{"object_id":oid})["ok"])
        self.assertTrue(self.doc.objects[0].selected)
        self.assertTrue(self.run_action("change_property",{"object_id":oid,"property":"display_color","rgb":[0.2,0.3,0.4]})["ok"])
    def test_invalid_macro_and_numbers(self):
        for verb,args in [("exec",{}),("create_object",{"kind":"box","name":"x","dimensions_mm":[1,1,1],"script":"import os"}),("create_object",{"kind":"box","name":"x","dimensions_mm":[float('nan'),1,1]})]:
            r=self.run_action(verb,args);self.assertFalse(r["ok"]);self.assertFalse(r["may_have_changed"])
        self.assertFalse(self.doc.objects)
    def test_literal_injection_path(self):
        r=self.run_action("open_document",{"path":str(Path(self.root,"$(touch injected).c4d"))});self.assertFalse(r["ok"]);self.assertFalse(Path(self.root,"injected").exists())
    def test_unknown_and_scaled_objects(self):
        oid=self.box();self.doc.objects[0].scale=Vector(2);self.assertFalse(self.run_action("modify_dimensions",{"object_id":oid,"dimensions_mm":[1,1,1]})["ok"])
        self.doc.objects[0].tags=["PythonTag"];self.assertFalse(self.engine.scan()["safe_scene"])
        self.assertFalse(self.run_action("preview",{"mode":"viewport"})["ok"])
    def test_stale_revision(self):
        oid=self.box();old=self.engine.scan()["revision"];self.doc.objects[0].dirty+=1
        r=self.run_action("select_object",{"object_id":oid},old);self.assertFalse(r["ok"]);self.assertFalse(r["may_have_changed"])
    def test_undo_one_ary_edit(self):
        self.box();token=self.engine.scan()["undo_token"];self.assertTrue(token)
        self.assertTrue(self.run_action("undo",{"undo_token":token})["ok"]);self.assertFalse(self.doc.objects)
        self.assertFalse(self.run_action("undo",{"undo_token":token})["ok"])
    def test_external_change_invalidates_undo(self):
        self.box();token=self.engine.scan()["undo_token"];self.doc.dirty+=1;self.assertFalse(self.run_action("undo",{"undo_token":token})["ok"])
    def test_save_export_and_preview(self):
        self.box();r=self.run_action("save",{"path":str(Path(self.root,"saved.c4d"))});self.assertTrue(r["ok"],r)
        self.assertTrue(self.run_action("export",{"path":str(Path(self.root,"output.obj")),"format":"obj"})["ok"])
        self.assertFalse(self.run_action("export",{"path":str(Path(self.root,"output.step")),"format":"step"})["ok"])
        self.assertTrue(self.run_action("preview",{"mode":"viewport"})["ok"]);self.assertTrue(self.api.previewed)
        self.assertFalse(self.run_action("save",{"path":str(Path(self.root,"saved.c4d"))})["ok"])
    def test_open_and_scope(self):
        self.assertTrue(self.run_action("open_document",{"path":str(Path(self.root,"fixture.c4d"))})["ok"])
        self.assertFalse(self.run_action("open_document",{"path":"/etc/passwd"})["ok"])
    def test_partial_failure_is_uncertain(self):
        self.doc.AddUndo=lambda *args:False
        r=self.run_action("create_object",{"kind":"box","name":"x","dimensions_mm":[1,1,1]})
        self.assertFalse(r["ok"]);self.assertTrue(r["may_have_changed"]);self.assertEqual(len(self.doc.objects),1)

if __name__=="__main__":unittest.main()
