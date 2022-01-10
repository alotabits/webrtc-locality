import React from "react";
import ReactDOM from "react-dom";
import cx from "clsx";
import styles from "./App.module.css";
import { faPhone, faSpinner } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import produce from "immer";
const Peer = window.SimplePeer;
const P2PT = window.P2PT;

function usePrevious(value) {
  const ref = React.useRef(null);

  React.useEffect(() => {
    ref.current = value;
  }, [value]);

  return ref.current;
}

function useMounted() {
  const ref = React.useRef(true);

  React.useEffect(
    () => () => {
      ref.current = false;
    },
    []
  );

  return ref.current;
}

function usePromise(promise, initState = null) {
  const [state, setState] = React.useState(initState);

  React.useEffect(() => {
    let canceled = false;

    // eslint-disable-next-line no-unused-expressions
    promise?.then((value) => {
      if (!canceled) {
        setState(value);
      }
    });

    return () => {
      canceled = true;
    };
  }, [promise]);

  return state;
}

function useAsyncEffect(effect, deps) {
  const isMounted = useMounted();
  const mountedFuncRef = React.useRef(() => isMounted);

  React.useEffect(() => {
    effect(mountedFuncRef.current);
  }, deps);
}

/**
 * @param {Boolean} video
 * @param {Boolean} audio
 */
function useMediaStream({ video, audio }) {
  // Set a stable initState object in the ref.current
  // So a setState with that object when we're already in the initState will bail on re-render.
  const initState = React.useRef({
    mediaStream: null,
    error: null
  });

  const [state, setState] = React.useState(initState.current);

  useAsyncEffect(
    async (isMounted) => {
      try {
        setState(initState.current);

        const mediaStream = await navigator.mediaDevices.getUserMedia({
          audio,
          video
        });

        if (isMounted()) {
          setState({
            ...initState.current,
            mediaStream,
            error: null
          });
        }
      } catch (error) {
        console.log(error);
        if (isMounted()) {
          setState({
            ...initState.current,
            mediaStream: null,
            error
          });
        }
      }
    },
    [video, audio]
  );

  return state;
}

function Avatars({ children }) {
  return <div className={[styles.Avatars]}>{children}</div>;
}

function Avatar({
  localMediaStream,
  localLocation,
  localMuted,
  signalingPeer,
  onSignal,
  onVideoPeer
}) {
  const [videoPeer, setVideoPeer] = React.useState(null);
  const [peerMediaStream, setPeerMediaStream] = React.useState(null);
  const [peerLocation, setPeerLocation] = React.useState(() => {
    // Randomly outside grid?
    return [
      Math.random() * window.innerWidth,
      Math.random() * window.innerHeight
    ];
  });

  const [playing, setPlaying] = React.useState(false);
  const videoRef = React.useRef(null);

  React.useEffect(() => {
    if (!signalingPeer) {
      return;
    }

    const videoPeer = new Peer({
      initiator: signalingPeer.initiator,
      trickle: true,
      stream: localMediaStream
    });

    videoPeer.on("signal", (signal) => {
      console.log("videoPeer signal", signal);
      onSignal(signal);
    });

    videoPeer.on("stream", (stream) => {
      console.log("videoPeer stream");
      setPeerMediaStream(stream);
    });

    videoPeer.on("track", (track) => {
      console.log("videoPeer track", track);
    });

    videoPeer.on("data", (payload) => {
      const data = JSON.parse(payload);
      if (data.type === "location") {
        console.log("LOCATION", data);
        setPeerLocation(data.location);
      }
    });

    videoPeer.on("connect", () => {
      setVideoPeer(videoPeer);
    });

    onVideoPeer(videoPeer);
  }, [localMediaStream, signalingPeer, onSignal, onVideoPeer]);

  React.useEffect(() => {
    if (!videoPeer) {
      return;
    }

    const payload = { type: "location", location: localLocation };
    videoPeer.send(JSON.stringify(payload));
  }, [videoPeer, localLocation]);

  const videoRefFunc = React.useCallback(
    (/** @type HTMLMediaElement */ ref) => {
      videoRef.current = ref;
      if (ref) {
        ref.srcObject = signalingPeer ? peerMediaStream : localMediaStream;
        ref.play();
        setTimeout(() => setPlaying(true), 0); // TODO: mount check?
      }
    },
    [signalingPeer, localMediaStream, peerMediaStream]
  );

  const volume = React.useMemo(() => {
    if (!signalingPeer) {
      return 0;
    }

    const l = peerLocation;
    const m = localLocation;
    const d = Math.sqrt(Math.pow(m[0] - l[0], 2) + Math.pow(m[1] - l[1], 2));
    const v = Math.min(
      Math.max(Math.pow(1 - d / window.innerWidth, 2.0), 0.0),
      1.0
    );
    return v;
  }, [signalingPeer, peerLocation, localLocation]);

  React.useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = volume;
    }
  }, [volume]);

  const location = signalingPeer ? peerLocation : localLocation;
  const transform = `translate(${location[0]}px, ${location[1]}px) translate(-50%, -50%)`;

  return (
    <div
      className={cx(styles.Avatar, playing && styles.avatarVideo)}
      style={{ transform }}
    >
      <div className={styles.avatarInset}>
        <video ref={videoRefFunc} muted={!signalingPeer} autoPlay />
        <div className={styles.avatarVolume}>{Math.ceil(volume * 100)}</div>
      </div>
    </div>
  );
}

function gatherLocalDescription(pc) {
  return new Promise((resolve, reject) => {
    pc.addEventListener("icecandidate", (e) => {
      console.log("icecandidate", e);
      if (e.candidate === null) {
        console.log("FINAL");
        resolve(pc.localDescription);
      }
    });
    pc.addEventListener("icecandidateerror", (e) => {
      console.log("icecandidateerror", e);
      reject(e);
    });
  });
}

function CallButton({ mediaStream, onConnect }) {
  const STATE_INIT = "init";
  const STATE_GENERATING = "generating";
  const STATE_WAITING = "waiting";

  const [state, setState] = React.useState(STATE_INIT);
  const [peerConn, setPeerConn] = React.useState(null);
  const onConnectRef = React.useRef(onConnect);

  const handleMakeCall = React.useCallback(async () => {
    try {
      setState(STATE_GENERATING);
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
      });
      mediaStream
        .getTracks()
        .forEach((track) => pc.addTrack(track, mediaStream));

      // Use a promise so that caller/answerer look the same to Avatar code.
      pc.dataChannel = Promise.resolve(pc.createDataChannel("avatar"));
      const iceGathering = gatherLocalDescription(pc);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const finalOffer = await iceGathering;

      await navigator.clipboard.writeText(JSON.stringify(finalOffer));
      setState(STATE_WAITING);
      setPeerConn(pc);
    } catch (e) {
      console.log("handleMakeCall", e);
      setState(STATE_INIT);
      setPeerConn(null);
    }
  }, [mediaStream]);

  const handleReceiveAnswer = React.useCallback(async () => {
    try {
      const answer = JSON.parse(await navigator.clipboard.readText());
      const answerDesc = new RTCSessionDescription(answer);
      await peerConn.setRemoteDescription(answerDesc);
      onConnectRef.current(peerConn);
      setState(STATE_INIT);
      setPeerConn(null);
    } catch (err) {
      setState(STATE_INIT);
      setPeerConn(null);
    }
  }, [peerConn]);

  React.useEffect(() => {
    onConnectRef.current = onConnect;
  }, [onConnect]);

  return (
    <>
      <div className={styles.CallButton}>
        <button
          type="button"
          className={styles.callButton}
          onClick={handleMakeCall}
          disabled={state !== STATE_INIT}
        >
          {state === STATE_GENERATING ? (
            <FontAwesomeIcon className={styles.spin} icon={faSpinner} />
          ) : (
            <FontAwesomeIcon icon={faPhone} />
          )}
        </button>
        <div>Call</div>
      </div>
      {state === STATE_WAITING &&
        ReactDOM.createPortal(
          <div className={styles.callButtonOverlay}>
            <div className={styles.callButtonDialog}>
              <div>Call copied to clipboard. Awaiting answer.</div>
              <div>Click Connect when answer is in clipboard.</div>
              <button type="button" onClick={handleReceiveAnswer}>
                Connect
              </button>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

function AnswerButton({ mediaStream, onConnect }) {
  const STATE_INIT = "init";
  const STATE_GENERATING = "generating";

  const [state, setState] = React.useState(STATE_INIT);
  const onConnectRef = React.useRef(onConnect);

  const handleMakeAnswer = React.useCallback(async () => {
    try {
      setState(STATE_GENERATING);
      const pc = new RTCPeerConnection({
        //iceServers: [{ urls: "stun:23.21.150.121" }]
      });
      mediaStream
        .getTracks()
        .forEach((track) => pc.addTrack(track, mediaStream));

      // The calling side is responsible for creating the data channel
      pc.dataChannel = new Promise((resolve) => {
        pc.addEventListener("datachannel", (e) => {
          resolve(e.channel);
        });
      });

      const offer = JSON.parse(await navigator.clipboard.readText());
      const offerDesc = new RTCSessionDescription(offer);
      await pc.setRemoteDescription(offerDesc);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      await navigator.clipboard.writeText(JSON.stringify(answer));
      onConnectRef.current(pc);
      setState(STATE_INIT);
    } catch (e) {
      console.log("handleMakeAnswer", e);
      setState(STATE_INIT);
    }
  }, [mediaStream]);

  React.useEffect(() => {
    onConnectRef.current = onConnect;
  }, [onConnect]);

  return (
    <div className={styles.AnswerButton}>
      <button
        type="button"
        className={styles.answerButton}
        onClick={handleMakeAnswer}
      >
        {state === STATE_GENERATING ? (
          <FontAwesomeIcon className={styles.spin} icon={faSpinner} />
        ) : (
          <FontAwesomeIcon icon={faPhone} />
        )}
      </button>
      <div>Answer</div>
    </div>
  );
}

function HUD({ children, onChooseLocation }) {
  return (
    <div className={styles.HUD}>
      <div
        className={styles.hudLocator}
        onClick={(e) =>
          console.log("click", e.clientX) ||
          onChooseLocation([e.clientX, e.clientY])
        }
      />
      {children}
    </div>
  );
}

export default function App() {
  const [p2, setP2] = React.useState(null);

  const [location, setLocation] = React.useState(() => [
    window.innerWidth / 2,
    window.innerHeight / 2
  ]);

  const { mediaStream } = useMediaStream({
    video: true,
    audio: true
  });

  const [avatars, setAvatars] = React.useState({});

  const handleJoin = React.useCallback(() => {
    const room = window.location.hash || "general";

    let announceURLs = [
      "wss://tracker.openwebtorrent.com",
      "wss://tracker.sloppyta.co:443/announce",
      "wss://tracker.novage.com.ua:443/announce"
      // Connections fail: "wss://tracker.btorrent.xyz:443/announce"
    ];

    if (window.location.hostname === "localhost") {
      announceURLs = ["ws://localhost:5000"];
    }

    const p2pt = new P2PT(announceURLs, "webrtc-locality-" + room);

    p2pt.on("peerconnect", (peer) => {
      console.log("peerconnect");

      const onSignal = (signal) => {
        console.log("signal", signal);
        p2pt.send(peer, {
          type: "signal",
          signal
        });
      };

      const onVideoPeer = (videoPeer) => {
        // We probably need a way to tie these handlers to the avatar object and remove them
        // Maybe it really does make sense to have the p2pt exposed as a pubsub context.
        p2pt.on("msg", (msgPeer, msg) => {
          // Reject messages for other peers, since this is a common bus
          console.log("msg", peer, msg);
          if (msgPeer.id !== peer.id || msg.type !== "signal") {
            return;
          }

          videoPeer.signal(msg.signal);
        });
      };

      p2pt.on("msg", (msgPeer, msg) => {
        // Reject messages for other peers, since this is a common bus
        console.log("msg", peer, msg);
        if (msgPeer.id !== peer.id) {
          return;
        }

        switch (msg.type) {
          case "removeTrack":
          default:
        }
      });

      setAvatars(
        produce((draftAvatars) => {
          draftAvatars[peer.id] = {
            signalingPeer: peer,
            onSignal,
            onVideoPeer
          };
        })
      );
    });

    p2pt.on("peerclose", (peer) => {
      console.log("peerclose");
      setAvatars(
        produce((draftAvatars) => {
          delete draftAvatars[peer.id];
        })
      );
    });

    p2pt.start();
    setP2(p2pt);
  }, []);

  // const handleConnect = (/** @type RTCPeerConnection */ peerConn) => {
  //   console.log("CONNECTED", peerConn);

  //   const mediaStream = new MediaStream(
  //     peerConn.getReceivers().map((receiver) => receiver.track)
  //   );

  //   setPeers((prevPeers) => [
  //     ...prevPeers,
  //     {
  //       peerConn,
  //       mediaStream,
  //       sync: {
  //         stale: false
  //       }
  //     }
  //   ]);

  //   peerConn.addEventListener("connectionstatechange", (event) => {
  //     switch (event.target.connectionState) {
  //       case "connected":
  //         // The connection has become fully connected
  //         break;
  //       case "disconnected":
  //       case "failed":
  //         // One or more transports has terminated unexpectedly or in an error
  //         setPeers((peers) =>
  //           peers.filter((peer) => peer.mediaStream.id !== mediaStream.id)
  //         );
  //         break;
  //       case "closed":
  //         // The connection has been closed
  //         setPeers((peers) =>
  //           peers.filter((peer) => peer.mediaStream.id !== mediaStream.id)
  //         );
  //         break;
  //       default:
  //         break;
  //     }
  //   });
  // };

  const handleChooseLocation = (location) => {
    setLocation(location);

    /*
    Object.values(avatars).forEach((peer) => {
      p2.send(peer.peer, {
        type: "location",
        location
      });
    });
    */
  };

  return (
    <>
      <Avatars>
        {Object.values(avatars).map((avatar) => (
          <Avatar
            key={avatar.signalingPeer.id}
            localMediaStream={mediaStream}
            localLocation={location}
            localMuted={false}
            {...avatar}
          />
        ))}

        <Avatar
          localMediaStream={mediaStream}
          localLocation={location}
          localMuted={false}
          signalingPeer={null}
          onSignal={null}
          onVidePeer={null}
        />
      </Avatars>

      <HUD onChooseLocation={handleChooseLocation}>
        <button
          type="button"
          style={{ position: "absolute", left: "0", top: "0" }}
          onClick={handleJoin}
        >
          Join
        </button>
        {/* <CallButton mediastream={mediaStream} onconnect={handleConnect} /> */}
        {/* <AnswerButton mediaStream={mediaStream} onConnect={handleConnect} /> */}
      </HUD>
    </>
  );
}
