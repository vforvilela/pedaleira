import Foundation
import Capacitor
import CoreMIDI

// MIDI nativo: o WKWebView não tem Web MIDI. Liga todas as fontes do CoreMIDI (USB pelo adaptador, Bluetooth MIDI,
// rede) e entrega cada mensagem ao JS no evento "message" com os bytes crus, como o onmidimessage do navegador.
// Aparelho ligado depois também entra: o CoreMIDI avisa pela notificação de setup.
@objc(MidiPlugin)
public class MidiPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MidiPlugin"
    public let jsName = "Midi"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "list", returnType: CAPPluginReturnPromise)
    ]

    private var client = MIDIClientRef()
    private var port = MIDIPortRef()
    private var started = false

    @objc func start(_ call: CAPPluginCall) {
        if !started {
            started = true
            MIDIClientCreateWithBlock("ToneSmith" as CFString, &client) { [weak self] _ in
                DispatchQueue.main.async { self?.connectAll() }
            }
            MIDIInputPortCreateWithProtocol(client, "ToneSmith in" as CFString, ._1_0, &port) { [weak self] list, _ in
                self?.receive(list)
            }
            connectAll()
        }
        call.resolve(inputs())
    }

    @objc func list(_ call: CAPPluginCall) { call.resolve(inputs()) }

    private func inputs() -> [String: Any] {
        var names: [String] = []
        for i in 0..<MIDIGetNumberOfSources() {
            var name: Unmanaged<CFString>?
            MIDIObjectGetStringProperty(MIDIGetSource(i), kMIDIPropertyDisplayName, &name)
            names.append(name?.takeRetainedValue() as String? ?? "MIDI \(i + 1)")
        }
        return ["inputs": names]
    }

    // Reconectar uma fonte já ligada não faz mal: o CoreMIDI ignora.
    private func connectAll() {
        for i in 0..<MIDIGetNumberOfSources() { MIDIPortConnectSource(port, MIDIGetSource(i), nil) }
        notifyListeners("inputs", data: inputs())
    }

    // Com o protocolo 1.0 cada palavra UMP de tipo 2 é uma mensagem de canal inteira (status, dado 1, dado 2),
    // sem running status. SysEx e realtime têm outros tipos e ficam de fora.
    private func receive(_ list: UnsafePointer<MIDIEventList>) {
        for packet in list.unsafeSequence() {
            for word in packet.words() {
                guard (word >> 28) & 0xf == 2 else { continue }
                let status = Int((word >> 16) & 0xff), d1 = Int((word >> 8) & 0xff), d2 = Int(word & 0xff)
                let type = status & 0xf0
                let data = (type == 0xc0 || type == 0xd0) ? [status, d1] : [status, d1, d2]
                notifyListeners("message", data: ["data": data])
            }
        }
    }
}
