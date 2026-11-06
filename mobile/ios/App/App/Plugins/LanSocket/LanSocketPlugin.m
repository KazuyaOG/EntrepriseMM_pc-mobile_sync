#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

// Enregistrement du greffon auprès de Capacitor (nécessaire en Objective-C).
CAP_PLUGIN(LanSocketPlugin, "LanSocket",
           CAP_PLUGIN_METHOD(openSocket, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(sendSocket, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(closeSocket, CAPPluginReturnPromise);
)
