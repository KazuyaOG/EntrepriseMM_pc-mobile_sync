import Foundation
import Capacitor

/// WebSocket native pour joindre le PC sur le réseau local.
///
/// WKWebView bloque les connexions ws:// non sécurisées vers une adresse IP
/// locale. Ce greffon fournit la même chose côté natif, puis renvoie les
/// trames au code JavaScript sous forme d'évènements « socketEvent ».
@objc(LanSocketPlugin)
public class LanSocketPlugin: CAPPlugin, CAPBridgedPlugin, URLSessionWebSocketDelegate {
    public let identifier = "LanSocketPlugin"
    public let jsName = "LanSocket"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "openSocket", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sendSocket", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "closeSocket", returnType: CAPPluginReturnPromise)
    ]

    private var sockets: [String: URLSessionWebSocketTask] = [:]
    private var session: URLSession!

    override public func load() {
        let configuration = URLSessionConfiguration.default
        configuration.waitsForConnectivity = true
        configuration.timeoutIntervalForRequest = 15
        session = URLSession(configuration: configuration, delegate: self, delegateQueue: OperationQueue())
    }

    @objc func openSocket(_ call: CAPPluginCall) {
        guard let raw = call.getString("url"), let url = URL(string: raw) else {
            call.reject("Adresse invalide.")
            return
        }
        guard url.scheme == "ws" || url.scheme == "wss" else {
            call.reject("Seules les adresses ws:// et wss:// sont acceptées.")
            return
        }
        let id = UUID().uuidString
        let task = session.webSocketTask(with: url)
        sockets[id] = task
        task.resume()
        // La connexion est confirmée par le délégué ; on escoute les messages.
        listen(id: id, task: task)
        call.resolve(["ok": true, "id": id])
    }

    @objc func sendSocket(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), let task = sockets[id] else {
            call.reject("Connexion inconnue.")
            return
        }
        guard let text = call.getString("text") else {
            call.reject("Message vide.")
            return
        }
        task.send(.string(text)) { error in
            if let error = error {
                call.reject(error.localizedDescription)
            } else {
                call.resolve()
            }
        }
    }

    @objc func closeSocket(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else {
            call.reject("Connexion inconnue.")
            return
        }
        sockets[id]?.cancel(with: .goingAway, reason: nil)
        sockets.removeValue(forKey: id)
        call.resolve()
    }

    private func listen(id: String, task: URLSessionWebSocketTask) {
        task.receive { [weak self] result in
            guard let self = self else { return }
            guard self.sockets[id] != nil else { return }
            switch result {
            case .success(let message):
                switch message {
                case .string(let text):
                    self.notifyListeners("socketEvent", data: ["id": id, "type": "message", "text": text])
                case .data(let data):
                    if let text = String(data: data, encoding: .utf8) {
                        self.notifyListeners("socketEvent", data: ["id": id, "type": "message", "text": text])
                    }
                @unknown default:
                    break
                }
                self.listen(id: id, task: task)
            case .failure(let error):
                self.sockets.removeValue(forKey: id)
                self.notifyListeners("socketEvent", data: ["id": id, "type": "closed", "code": 1006, "reason": error.localizedDescription])
            }
        }
    }

    public func urlSession(_ session: URLSession,
                           webSocketTask: URLSessionWebSocketTask,
                           didCloseWith closeCode: URLSessionWebSocketTask.CloseCode,
                           reason: Data?) {
        guard let id = sockets.first(where: { $0.value === webSocketTask })?.key else { return }
        sockets.removeValue(forKey: id)
        let text = reason.flatMap { String(data: $0, encoding: .utf8) } ?? ""
        notifyListeners("socketEvent", data: ["id": id, "type": "closed", "code": Int(closeCode.rawValue), "reason": text])
    }

    public func urlSession(_ session: URLSession,
                           webSocketTask: URLSessionWebSocketTask,
                           didOpenWithProtocol protocol: String?) {
        guard let id = sockets.first(where: { $0.value === webSocketTask })?.key else { return }
        notifyListeners("socketEvent", data: ["id": id, "type": "opened"])
    }
}
