"""Local development Cinema 4D MessageData plugin. Fixed loopback endpoint."""
import importlib.util
import json
import os
import re
import urllib.request
import c4d
# Always load our fixed sibling module, never a caller-selected Python path.
_spec = importlib.util.spec_from_file_location("ary_design_engine_v1", os.path.join(os.path.dirname(__file__), "ary_design_engine.py"))
_engine = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_engine)
DesignEngine = _engine.DesignEngine

# Local development ID. Obtain an official unique Maxon plugin ID before distribution.
PLUGIN_ID=1000001
class AryDesign(c4d.plugins.MessageData):
    def __init__(self, config):
        self.token=config["token"]
        self.engine=DesignEngine(c4d,config["allowed_roots"])
        self.pending=None
        self.opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
        self.last_error=None
    def GetTimer(self):return 2000
    def request(self, route, data):
        payload=json.dumps(data,allow_nan=False).encode()
        if len(payload)>65536:raise ValueError("Design state exceeds 64 KB; narrow the scene")
        request=urllib.request.Request("http://127.0.0.1:3000/api/design/bridge/"+route,data=payload,headers={"Authorization":"Bearer "+self.token,"Content-Type":"application/json"},method="POST")
        with self.opener.open(request,timeout=0.5) as response:
            raw=response.read(65537)
            if len(raw)>65536:raise ValueError("Oversized design response")
            return json.loads(raw)
    def CoreMessage(self, mid, bc):
        if mid!=c4d.MSG_TIMER:return True
        try:
            if self.pending:
                self.request("result",self.pending)
                self.pending=None
            job=self.request("poll",{"state":self.engine.scan()})
            if job:
                # The server durably claims before delivery; edits are never replayed.
                self.pending={"operation_id":job["operation_id"],"receipt":self.engine.execute(job)}
                self.request("result",self.pending)
                self.pending=None
            self.last_error=None
        except Exception as error:
            message=str(error)
            if message!=self.last_error:print("Ary Design:",message)
            self.last_error=message
        return True

if __name__=="__main__":
    config_path=os.path.join(os.path.dirname(__file__),"bridge.local.json")
    if os.path.isfile(config_path):
        with open(config_path,encoding="utf-8") as file:config=json.load(file)
        if config.get("enabled") is True and re.fullmatch(r"[a-fA-F0-9]{64}",config.get("token","")) and isinstance(config.get("allowed_roots"),list) and config["allowed_roots"]:
            if not c4d.plugins.RegisterMessagePlugin(id=PLUGIN_ID,str="Ary Design Bridge",info=0,dat=AryDesign(config)):
                print("Ary Design: plugin ID conflict; bridge was not registered")
