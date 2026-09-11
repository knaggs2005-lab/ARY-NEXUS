// Disposable acceptance app only. No files, network, account or real-user content.
import AppKit
final class Canvas:NSView {
 override func acceptsFirstMouse(for event:NSEvent?) -> Bool {true}
 override var acceptsFirstResponder:Bool {true}
 override func draw(_ dirtyRect:NSRect) {
  NSColor.windowBackgroundColor.setFill();bounds.fill()
  NSColor.systemBlue.setFill();NSBezierPath(ovalIn:NSRect(x:bounds.midX-30,y:bounds.midY-30,width:60,height:60)).fill()
 }
 override func mouseDown(with event:NSEvent){
  let point=convert(event.locationInWindow,from:nil),dx=point.x-bounds.midX,dy=point.y-bounds.midY
  window?.title = dx*dx+dy*dy <= 900 ? "Visual fixture clicked" : "Wrong fixture target"
 }
}
final class Delegate:NSObject,NSApplicationDelegate {
 var window:NSWindow!
 @objc func save(){ window.title="Fixture saved" }
 func applicationDidFinishLaunching(_ notification:Notification){
  window=NSWindow(contentRect:NSRect(x:200,y:200,width:420,height:220),styleMask:[.titled,.closable],backing:.buffered,defer:false)
  window.title="Ary Control Fixture"
  let field=NSTextField(frame:NSRect(x:30,y:125,width:350,height:28));field.stringValue="Fixture original";field.setAccessibilityLabel("Task title")
  let button=NSButton(frame:NSRect(x:30,y:60,width:150,height:32));button.title="Save fixture";button.target=self;button.action=#selector(save)
  if ProcessInfo.processInfo.arguments.contains("--canvas") {window.contentView=Canvas(frame:NSRect(x:0,y:0,width:420,height:220))}
  else {window.contentView?.addSubview(field);window.contentView?.addSubview(button)}
  let menu=NSMenu();let item=NSMenuItem();let sub=NSMenu();sub.addItem(withTitle:"Quit fixture",action:#selector(NSApplication.terminate(_:)),keyEquivalent:"q");item.submenu=sub;menu.addItem(item);NSApplication.shared.mainMenu=menu
  NSEvent.addLocalMonitorForEvents(matching:[.leftMouseDown,.leftMouseUp]) { event in
   let record:[String:Any] = ["event":event.type.rawValue,"x":event.locationInWindow.x,"y":event.locationInWindow.y,"event_window":event.windowNumber,"fixture_window":self.window.windowNumber,"content":NSStringFromRect(self.window.contentView!.frame)]
   if let data=try? JSONSerialization.data(withJSONObject:record) {try? data.write(to:Bundle.main.bundleURL.deletingLastPathComponent().appendingPathComponent("fixture-events.json"))}
   return event
  }
  window.makeKeyAndOrderFront(nil);NSApplication.shared.activate(ignoringOtherApps:true)
 }
}
let app=NSApplication.shared, delegate=Delegate();app.setActivationPolicy(.regular);app.delegate=delegate;app.run()
