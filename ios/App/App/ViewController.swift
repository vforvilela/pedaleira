import UIKit
import Capacitor

// Plugins locais (só deste app) entram na ponte aqui; os de pacote npm o Capacitor registra sozinho.
class ViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(MidiPlugin())
        bridge?.registerPluginInstance(AudioSessionPlugin())
    }
}
