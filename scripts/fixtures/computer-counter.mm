#import <Cocoa/Cocoa.h>

@interface CounterDelegate : NSObject <NSApplicationDelegate>
@property(nonatomic, strong) NSWindow *window;
@property(nonatomic, strong) NSTextField *label;
@property(nonatomic, strong) NSString *statePath;
@property(nonatomic) NSInteger count;
@end

@implementation CounterDelegate
- (void)persist {
  NSError *error = nil;
  NSData *data = [NSJSONSerialization dataWithJSONObject:@{ @"count": @(self.count) } options:0 error:&error];
  if (!data || ![data writeToFile:self.statePath options:NSDataWritingAtomic error:&error]) exit(3);
}
- (void)incrementCounter:(id)sender {
  (void)sender;
  self.count += 1;
  self.label.stringValue = [NSString stringWithFormat:@"Counter: %ld", (long)self.count];
  [self persist];
}
- (void)applicationDidFinishLaunching:(NSNotification *)notification {
  (void)notification;
  self.window = [[NSWindow alloc] initWithContentRect:NSMakeRect(120, 180, 640, 420)
    styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskMiniaturizable
    backing:NSBackingStoreBuffered defer:NO];
  self.window.title = @"XOPC isolated native counter";
  self.label = [NSTextField labelWithString:@"Counter: 0"];
  self.label.frame = NSMakeRect(220, 250, 300, 50);
  [self.window.contentView addSubview:self.label];
  NSButton *button = [NSButton buttonWithTitle:@"Increment controlled counter" target:self action:@selector(incrementCounter:)];
  button.frame = NSMakeRect(160, 140, 320, 70);
  [button setAccessibilityLabel:@"Increment controlled counter"];
  [self.window.contentView addSubview:button];
  [self persist];
  [self.window makeKeyAndOrderFront:nil];
  [NSApp activateIgnoringOtherApps:YES];
}
- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)application { (void)application; return YES; }
@end

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc != 2) return 2;
    NSString *path = [NSString stringWithUTF8String:argv[1]];
    if (!path.isAbsolutePath || ![path.lastPathComponent isEqualToString:@"fixture-state.json"]) return 2;
    NSApplication *application = [NSApplication sharedApplication];
    [application setActivationPolicy:NSApplicationActivationPolicyRegular];
    CounterDelegate *delegate = [CounterDelegate new]; delegate.statePath = path;
    application.delegate = delegate;
    [application run];
  }
  return 0;
}
