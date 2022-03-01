import produce from "immer";
import Peer from "peerjs";

export const actions = {
  setLocation: (location) => ({
    type: "location",
    location,
  }),

  setName: (name) => ({
    type: "name",
    name,
  }),

  setMediaStream: (mediaStream) => ({
    type: "mediaStream",
    mediaStream,
  }),

  setGroup: (group) => ({
    type: "group",
    group,
  }),

  sync: (sync) => ({
    type: "sync",
    sync,
  }),

  discover: (discover) => ({
    type: "discover",
    discover,
  }),
};

const peerReducerInit = {
  name: "",
  location: [
    Math.random() * document.documentElement.clientWidth,
    Math.random() * document.documentElement.clientHeight,
  ],
  mediaStream: null,
  group: null,
};

const peerReducer = produce((draft, action) => {
  switch (action.type) {
    case "location":
    case "name":
    case "mediaStream":
    case "group":
      draft[action.type] = action[action.type];
      break;
    case "sync":
      if (!draft) {
        return action.sync;
      }
      Object.assign(draft, action.sync);
      break;
    default:
      return draft;
  }
});

export class PeerJSHandler {
  constructor(remoteId) {
    this.remoteId = remoteId;
    this.peerState = peerReducerInit;
    this.dataConn = null;
    this.mediaConn = null;
    this.lastContact = {
      sentAt: Date.now(),
      receivedAt: Date.now(),
    };
  }

  id = () => this.remoteId;

  attach = ({ onPeerState }) => {
    this.onPeerState = onPeerState;
    this.onPeerState?.(this.peerState);
  };

  detach = () => {
    this.onPeerState = null;
  };

  send = (action) => {
    if (this.dataConn?.open) {
      this.lastContact.sentAt = Date.now();
      this.dataConn.send(action);
    }
  };

  setDataConnection = (dataConn, onDiscover) => {
    this.dataConn = dataConn;
    dataConn.on("open", () => {
      console.log("PeerJSHandler: peer data connection open event");

      dataConn.on("data", (data) => {
        this.lastContact.receivedAt = Date.now();

        if (data.type === "discover") {
          console.log(data);
          onDiscover(data.discover);
          return;
        }
        this.peerState = peerReducer(this.peerState, data);
        this.onPeerState?.(this.peerState);
      });
    });
  };

  setMediaConnection = (mediaConn) => {
    this.mediaConn = mediaConn;
    mediaConn.on("stream", (peerMediaStream) => {
      console.log("PeerJSHandler: peer media stream event");
      this.peerState = peerReducer(
        this.peerState,
        actions.setMediaStream(peerMediaStream)
      );
      this.onPeerState?.(this.peerState);
    });
  };

  getLastContact = () => this.lastContact;

  close = () => {
    if (this.mediaConn?.open) {
      this.mediaConn.close();
    }
    if (this.dataConn?.open) {
      this.dataConn.close();
    }
  };
}

// Handles signaling through PeerJS without peer discovery.
export class PeerJSManager {
  constructor({ location }) {
    this.localState = { ...peerReducerInit, location };
    this.peerHandlers = new Map();
    this.heartBeatQueue = [];
    this.heartBeatTimeout = null;
  }

  _getPeer = (id) => {
    let peerHandler = this.peerHandlers.get(id);
    if (!peerHandler) {
      peerHandler = new PeerJSHandler(id);
      this.peerHandlers.set(id, peerHandler);
    }
    return peerHandler;
  };

  _closePeer = (id) => {
    this.peerHandlers.delete(id);
    this.heartBeatQueue = this.heartBeatQueue.filter(
      (queuePeerHandler) => queuePeerHandler.id() !== id
    );
    this.onPeerDisconnect?.(id);
  };

  _discover = (peers) => {
    peers.forEach((peer) => {
      this.connect(peer.id);
    });
  };

  dispatch = (action) => {
    this.localState = peerReducer(this.localState, action);
    if (action.type !== "mediaStream") {
      this.peerHandlers.forEach((peerHandler) => {
        peerHandler.send(action);
      });
    }
    return this.localState;
  };

  getLocalState = () => {
    return this.localState;
  };

  start = async ({ onPeerConnect, onPeerDisconnect, onFatal }) => {
    return new Promise((resolve, reject) => {
      this.onPeerConnect = onPeerConnect;
      this.onPeerDisconnect = onPeerDisconnect;
      this.onFatal = onFatal;

      this.peer = new Peer();

      let resolved = false;
      let rejected = false;

      this.peer.on("open", (id) => {
        if (!resolved && !rejected) {
          console.log("PeerJSManager: start open");
          resolved = true;
          resolve();
        }

        this.id = id;
      });

      this.peer.on("error", (error) => {
        if (!resolved && !rejected) {
          console.error("PeerJSManager: connect error: ", error);
          rejected = true;
          reject(error);
        }

        switch (error.type) {
          case "browser-incompatible":
          case "invalid-id":
          case "invalid-key":
          case "ssl-unavailable":
          case "server-error":
          case "socket-error":
          case "socket-closed":
            // Fatal errors
            // TODO: Let parent know;
            console.error("PeerJSManager: fatal error received", error);
            break;
          case "disconnected":
          case "network":
          case "peer-unavailable":
          case "webrtc":
            // Non-fatal errors
            console.error("PeerJSManager: non-fatal error received", error);
            break;
          case "unavailable-id":
            // Sometimes fatal
            console.error("PeerJSManager: id is unavailable", error);
            break;
          default:
            console.error("PeerJSManager: unknown error received", error);
        }
      });

      this.peer.on("connection", (dataConn) => {
        console.log("PeerJSManager: received peer data connection");

        const peerHandler = this._getPeer(dataConn.peer);
        peerHandler.setDataConnection(dataConn, this._discover);

        dataConn.on("open", () => {
          const { mediaStream: discard, ...sync } = this.localState;
          dataConn.send(actions.sync(sync));
          dataConn.send(
            actions.discover(
              Array.from(this.peerHandlers, ([name, value]) => ({
                id: value.id(),
              }))
            )
          );
          this.heartBeatQueue.push(peerHandler);
          this.onPeerConnect?.(dataConn.peer, peerHandler);
        });

        dataConn.on("close", () => {
          this._closePeer(dataConn.peer);
        });

        dataConn.on("error", (error) => {
          console.log("PeerJSManager: data connection error event.", error);
        });
      });

      this.peer.on("call", (mediaConn) => {
        console.log("PeerJSManager: received peer media connection.");

        mediaConn.answer(this.localState.mediaStream);
        const peerHandler = this._getPeer(mediaConn.peer);
        peerHandler.setMediaConnection(mediaConn);

        mediaConn.on("stream", () => {
          console.log("PeerJSManager: media connection stream event.");
        });

        mediaConn.on("close", () => {
          console.log("PeerJSManager: media connection close event.");
        });

        mediaConn.on("error", (error) => {
          console.log("PeerJSManager: media connection error event.", error);
        });
      });

      this.peer.on("disconnected", () => {
        console.log("PeerJSManager: peer disconnected.");
        this.peer.reconnect();
        // Should keep track of number of reconnect attempts?
      });

      this.peer.on("close", () => {
        console.log("PeerJSManager: peer connection closed.");
        this.peer.destroy();
        this.onFatal?.();
      });

      this.heartbeat();
    });
  };

  heartbeat = () => {
    const delay =
      this.heartBeatQueue.length > 0 ? 1000 / this.heartBeatQueue.length : 1000;
    this.heartBeatTimeout = setTimeout(this.heartbeat, delay);

    if (this.heartBeatQueue.length === 0) {
      return;
    }

    const peerHandler = this.heartBeatQueue.shift();
    const lastContact = peerHandler.getLastContact();
    const now = Date.now();

    if (lastContact.receivedAt < now - 5000) {
      console.log("heartbeat: closing dormant connection");
      peerHandler.close();
      return;
    }

    const { mediaStream: discard, ...sync } = this.localState;
    peerHandler.send(actions.sync(sync));
    this.heartBeatQueue.push(peerHandler);
  };

  stop = () => {
    this.peerHandlers.forEach((peerHandler) => peerHandler.close());
    this.peer.destroy();
    this.localState = peerReducerInit;
    this.peerHandlers = new Map();
    clearTimeout(this.heartBeatTimeout);
    this.heartBeatQueue = [];
  };

  connect = async (remoteId, initial) => {
    return new Promise((resolve, reject) => {
      if (remoteId === this.id) {
        console.log(`PeerJSManager: skipping connect to self at ${remoteId}`);
        resolve();
        return;
      }

      if (this.peerHandlers.has(remoteId)) {
        console.log(`PeerJSManager: already connected to ${remoteId}`);
        resolve();
        return;
      }

      console.log(`PeerJSManager: connecting to ${remoteId}`);
      const peerHandler = this._getPeer(remoteId);

      this.peer.on("error", (error) => {
        if (initial && !resolved && !rejected) {
          console.error("PeerJSManager: connect error initial: ", error);
          rejected = true;
          reject(error);
          this._closePeer(remoteId);
        }
      });

      const dataConn = this.peer.connect(remoteId, {
        reliable: true,
        serialization: "json",
      });

      let resolved = false;
      let rejected = false;

      dataConn.on("open", () => {
        console.log("PeerJSManager: connect open");
        if (!resolved && !rejected) {
          resolved = true;
          resolve();
        } else {
          return;
        }

        const { mediaStream: discard, ...sync } = this.localState;
        dataConn.send(actions.sync(sync));
        this.heartBeatQueue.push(peerHandler);
        this.onPeerConnect?.(dataConn.peer, peerHandler);

        // TODO: move mediaConn inside dataConn?
      });

      dataConn.on("close", () => {
        this._closePeer(dataConn.peer);
      });

      dataConn.on("error", (error) => {
        console.error("PeerJSManager: connect error: ", error);
        if (!resolved && !rejected) {
          rejected = true;
          reject(error);
        }

        // TODO: handler errors
      });

      const mediaConn = this.peer.call(remoteId, this.localState.mediaStream);

      mediaConn.on("close", () => {
        console.log("PeerJSManager: media connection closed.");
      });

      mediaConn.on("error", (error) => {
        console.log("PeerJSManager: media connection error: ", error);
      });

      peerHandler.setDataConnection(dataConn, this._discover);
      peerHandler.setMediaConnection(mediaConn);
    });
  };
}
