import Foundation
import AppKit
import ApplicationServices
import ScreenCaptureKit

struct ControlError: Error { let message: String }
func fail(_ message: String) throws -> Never { throw ControlError(message: message) }
func attr(_ e: AXUIElement, _ key: String) -> CFTypeRef? { var v: CFTypeRef?; return AXUIElementCopyAttributeValue(e, key as CFString, &v) == .success ? v : nil }
func string(_ e: AXUIElement, _ key: String) -> String { (attr(e,key) as? String) ?? "" }
func children(_ e: AXUIElement, _ key: String = kAXChildrenAttribute) -> [AXUIElement] { (attr(e,key) as? [AXUIElement]) ?? [] }
func bounds(_ e: AXUIElement) -> CGRect {
 var point = CGPoint.zero; var size = CGSize.zero
 if let v=attr(e,kAXPositionAttribute), CFGetTypeID(v)==AXValueGetTypeID() { AXValueGetValue(unsafeBitCast(v,to:AXValue.self), .cgPoint, &point) }
 if let v=attr(e,kAXSizeAttribute), CFGetTypeID(v)==AXValueGetTypeID() { AXValueGetValue(unsafeBitCast(v,to:AXValue.self), .cgSize, &size) }
 return CGRect(origin:point,size:size)
}
func box(_ r: CGRect) -> [String:Double] { ["x":r.minX,"y":r.minY,"width":r.width,"height":r.height] }
func node(_ e: AXUIElement, _ path: String) -> [String:Any] {
 let role=string(e,kAXRoleAttribute), sub=string(e,kAXSubroleAttribute)
 let label=String((string(e,kAXTitleAttribute).isEmpty ? string(e,kAXDescriptionAttribute) : string(e,kAXTitleAttribute)).prefix(180))
 let secure=sub==kAXSecureTextFieldSubrole || label.range(of:"password|secret|credit.?card|cvv|one.?time|token",options:[.regularExpression,.caseInsensitive]) != nil
 var names: CFArray?; AXUIElementCopyActionNames(e,&names)
 var actions:[String]=[]
 if !secure {
  if ((names as? [String]) ?? []).contains(kAXPressAction) { actions.append("click") }
  var settable:DarwinBoolean=false
  if [kAXTextFieldRole,kAXTextAreaRole].contains(role), AXUIElementIsAttributeSettable(e,kAXValueAttribute as CFString,&settable) == .success && settable.boolValue { actions += ["fill","key"] }
  if role==kAXWindowRole { actions.append("focus_window") }
 }
 return ["id":path,"role":role,"subrole":sub,"label":label,"value":secure ? "[protected]" : String(string(e,kAXValueAttribute).prefix(500)),"protected":secure,"actions":actions,"bounds":box(bounds(e))]
}
func tree(_ app: AXUIElement) -> [(AXUIElement,[String:Any])] {
 var result:[(AXUIElement,[String:Any])]=[]
 func walk(_ e:AXUIElement,_ path:String,_ depth:Int) {
  if result.count >= 200 || depth > 10 { return }
  result.append((e,node(e,path)))
  for (i,child) in children(e).enumerated() { walk(child,path+".\(i)",depth+1) }
 }
 for (i,w) in children(app,kAXWindowsAttribute).prefix(8).enumerated() { walk(w,"w\(i)",0) }
 if let bar=attr(app,kAXMenuBarAttribute) { walk(unsafeBitCast(bar,to:AXUIElement.self),"m",0) }
 return result
}
func same(_ a:[String:Any],_ b:[String:Any]) -> Bool { (try? JSONSerialization.data(withJSONObject:a,options:.sortedKeys)) == (try? JSONSerialization.data(withJSONObject:b,options:.sortedKeys)) }
@available(macOS 14.0, *)
@MainActor
func capture(_ pid:pid_t,_ rect:CGRect,_ title:String) async throws -> [String:Any] {
 _ = NSApplication.shared
 NSApplication.shared.setActivationPolicy(.prohibited)
 if !CGPreflightScreenCaptureAccess() { try fail("SCREEN_PERMISSION: Enable Screen & System Audio Recording for the Ary control helper in System Settings → Privacy & Security.") }
 let content=try await SCShareableContent.excludingDesktopWindows(true,onScreenWindowsOnly:true)
 let candidates=content.windows.filter { $0.owningApplication?.processID==pid && abs($0.frame.minX-rect.minX)<3 && abs($0.frame.minY-rect.minY)<3 && abs($0.frame.width-rect.width)<3 && abs($0.frame.height-rect.height)<3 }
 guard candidates.count==1 else { try fail("Window changed or cannot be uniquely matched for capture") }
 let window=candidates[0], config=SCStreamConfiguration()
 let scale=min(1.0,1536.0/max(rect.width,rect.height)); config.width=Int(rect.width*scale); config.height=Int(rect.height*scale); config.showsCursor=false
 let image=try await SCScreenshotManager.captureImage(contentFilter:SCContentFilter(desktopIndependentWindow:window),configuration:config)
 guard let data=NSBitmapImageRep(cgImage:image).representation(using:.png,properties:[:]), data.count <= 3*1024*1024 else { try fail("Captured image exceeds limit") }
 return ["image":data.base64EncodedString(),"bounds":box(rect),"window_title":title]
}
@MainActor
func execute(_ input:[String:Any]) async throws -> [String:Any] {
 guard let verb=input["verb"] as? String, ["inspect","act","capture","visual_click"].contains(verb), let appId=input["app_id"] as? String, appId.range(of:"^[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)+$",options:.regularExpression) != nil else { try fail("Invalid application/action name") }
 _ = NSApplication.shared
 NSApplication.shared.setActivationPolicy(.prohibited)
 if !AXIsProcessTrusted() { try fail("AX_PERMISSION: Enable Accessibility for the Ary control helper in System Settings → Privacy & Security. No control was dispatched.") }
 let apps=NSRunningApplication.runningApplications(withBundleIdentifier:appId)
 guard apps.count==1 else { try fail("App is not running or is ambiguous; use the existing app launcher first") }
 let running=apps[0], pid=running.processIdentifier, app=AXUIElementCreateApplication(pid)
 AXUIElementSetMessagingTimeout(app,2)
 let rows=tree(app)
 if verb=="inspect" { return ["pid":pid,"title":running.localizedName ?? appId,"elements":rows.map{$0.1},"truncated":rows.count>=200] }
 guard let id=input["element_id"] as? String, let row=rows.first(where:{$0.1["id"] as? String == id}), let expected=input["expected"] as? [String:Any], same(expected,row.1), input["pid"] as? Int == Int(pid) else { try fail("Stale native target; inspect again") }
 if ["capture","visual_click"].contains(verb) && row.1["role"] as? String != kAXWindowRole { try fail("A window target is required") }
 if verb=="capture" { if #available(macOS 14.0, *) { return try await capture(pid,bounds(row.0),string(row.0,kAXTitleAttribute)) }; try fail("Window capture requires macOS 14 or later") }
 guard NSWorkspace.shared.frontmostApplication?.processIdentifier == pid || input["action"] as? String == "focus_window" else { try fail("Target app is not frontmost; approve focus_window first") }
 if verb=="visual_click" {
  if !CGPreflightPostEventAccess() { try fail("AX_PERMISSION: Allow Accessibility event posting for the Ary control helper; no click was dispatched") }
  guard let x=input["x"] as? Double, let y=input["y"] as? Double, x>=0,x<=1,y>=0,y<=1 else { try fail("Invalid reviewed mouse point") }
  let r=bounds(row.0), point=CGPoint(x:r.minX+x*r.width,y:r.minY+y*r.height)
  if r.width<=0 || r.height<=0 { try fail("Window bounds unavailable") }
  // The provider re-captures and verifies exact pixels before invoking this fixed operation.
  var hit:AXUIElement?
  let hitStatus=AXUIElementCopyElementAtPosition(AXUIElementCreateSystemWide(),Float(point.x),Float(point.y),&hit)
  var hitPid:pid_t=0
  guard hitStatus == .success, let target=hit, AXUIElementGetPid(target,&hitPid) == .success, hitPid == pid else {try fail("The reviewed point is occluded or no longer belongs to the target application")}
  let hitWindow:AXUIElement? = string(target,kAXRoleAttribute)==kAXWindowRole ? target : attr(target,kAXWindowAttribute).map {unsafeBitCast($0,to:AXUIElement.self)}
  guard let observedWindow=hitWindow, CFEqual(observedWindow,row.0) else {try fail("The reviewed window is occluded by another window")}
  let infos=(CGWindowListCopyWindowInfo([.optionOnScreenOnly,.excludeDesktopElements],kCGNullWindowID) as? [[String:Any]]) ?? []
  let matching=infos.filter { info in
    guard info[kCGWindowOwnerPID as String] as? Int == Int(pid), let dict=info[kCGWindowBounds as String] as? [String:Any], let candidate=CGRect(dictionaryRepresentation:dict as CFDictionary) else {return false}
    return abs(candidate.minX-r.minX)<1 && abs(candidate.minY-r.minY)<1 && abs(candidate.width-r.width)<1 && abs(candidate.height-r.height)<1
  }
  guard matching.count==1, matching[0][kCGWindowNumber as String] is Int else {try fail("Window identity changed before event dispatch")}
  // WindowServer annotates guarded global points with the correct target-window coordinates.
  let source=CGEventSource(stateID:.combinedSessionState)
  var events:[CGEvent]=[]
  for type in [CGEventType.mouseMoved,.leftMouseDown,.leftMouseUp] {
   guard let event=CGEvent(mouseEventSource:source,mouseType:type,mouseCursorPosition:point,mouseButton:.left) else {try fail("Unable to create a mouse event")}
   event.flags=[];event.setIntegerValueField(.mouseEventClickState,value:1);events.append(event)
  }
  for event in events {event.post(tap:.cgSessionEventTap)}
  try await Task.sleep(nanoseconds:100_000_000)
  return ["dispatched":true,"method":"reviewed_visual_point"]
 }
 guard let action=input["action"] as? String, (row.1["actions"] as? [String] ?? []).contains(action) else { try fail("Unsupported action for native target") }
 var status:AXError = .success
 switch action {
 case "click": status=AXUIElementPerformAction(row.0,kAXPressAction as CFString)
 case "focus_window": running.activate(options:[]); status=AXUIElementPerformAction(row.0,kAXRaiseAction as CFString)
 case "fill": guard let value=input["value"] as? String, value.count<=8000 else { try fail("Invalid text") }; status=AXUIElementSetAttributeValue(row.0,kAXValueAttribute as CFString,value as CFString)
 case "key":
  if !CGPreflightPostEventAccess() { try fail("AX_PERMISSION: Allow Accessibility event posting for the Ary control helper; no key was dispatched") }
  let codes:[String:CGKeyCode] = ["Tab":48,"Shift+Tab":48,"Enter":36,"Escape":53,"ArrowUp":126,"ArrowDown":125,"ArrowLeft":123,"ArrowRight":124,"Space":49,"Backspace":51]
  guard let key=input["key"] as? String, let code=codes[key] else { try fail("Invalid key") }
  status=AXUIElementSetAttributeValue(row.0,kAXFocusedAttribute as CFString,kCFBooleanTrue)
  if status == .success {
   guard string(AXUIElementCreateApplication(pid),kAXRoleAttribute)==kAXApplicationRole, NSWorkspace.shared.frontmostApplication?.processIdentifier==pid, attr(row.0,kAXFocusedAttribute) as? Bool == true else {try fail("Keyboard focus changed; inspect again")}
   var events:[CGEvent]=[]
   for down in [true,false] {guard let event=CGEvent(keyboardEventSource:nil,virtualKey:code,keyDown:down) else {try fail("Unable to create key events")};event.flags = key=="Shift+Tab" ? .maskShift : [];events.append(event)}
   for event in events {event.post(tap:.cgSessionEventTap)}
   try await Task.sleep(nanoseconds:100_000_000)
  }
 default: try fail("Invalid native action")
 }
 if status != .success { try fail("AX action unavailable or rejected (\(status.rawValue)); inspect the current app before retrying") }
 return ["dispatched":true,"method":"AXUIElement","pid":pid]
}
@main struct Main {
 static func main() async {
  do { let data=FileHandle.standardInput.readDataToEndOfFile(); guard data.count<65536, let input=try JSONSerialization.jsonObject(with:data) as? [String:Any] else { try fail("Invalid request") }; let result=try await execute(input); FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject:result,options:.sortedKeys)) }
  catch { let message=(error as? ControlError)?.message ?? "Native control failed; inspect current app state"; FileHandle.standardOutput.write((try? JSONSerialization.data(withJSONObject:["error":message])) ?? Data()); exit(1) }
 }
}
