import Foundation
import Capacitor
import AVFoundation

// Sessão de áudio do iPhone com buffer curto, pedida pelo JS antes de ligar o áudio (js/platform.js).
// Sem isto o WKWebView usa o buffer padrão do sistema (~23 ms só na ida) e toca pelo A2DP se houver fone
// Bluetooth, que soma mais de 100 ms. "measurement": sem o processamento de voz do sistema no sinal da guitarra.
@objc(AudioSessionPlugin)
public class AudioSessionPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AudioSessionPlugin"
    public let jsName = "AudioSession"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "prepare", returnType: CAPPluginReturnPromise)
    ]

    @objc func prepare(_ call: CAPPluginCall) {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playAndRecord, mode: .measurement, options: [.allowBluetooth, .defaultToSpeaker])
            try session.setPreferredSampleRate(call.getDouble("sampleRate") ?? 48000)
            try session.setPreferredIOBufferDuration(call.getDouble("bufferSeconds") ?? 0.005)
            try session.setActive(true)
            call.resolve([
                "sampleRate": session.sampleRate,
                "bufferSeconds": session.ioBufferDuration,
                "inputLatency": session.inputLatency,
                "outputLatency": session.outputLatency
            ])
        } catch {
            call.reject(error.localizedDescription)
        }
    }
}
