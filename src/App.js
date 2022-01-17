import React from "react";
import ReactDOM from "react-dom";
import cx from "clsx";
import styles from "./App.module.css";
import { faPhone, faSpinner } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useMediaStream } from "./hooks";
import { useImmer } from "use-immer";
import { animated, useSpring, config as springConfig } from "react-spring";

const Peer = window.SimplePeer;
const P2PT = window.P2PT;

function Avatars({ children }) {
  return <div className={[styles.Avatars]}>{children}</div>;
}

function Avatar({ mediaStream, location, listenerLocation, muted }) {
  const [playing, setPlaying] = React.useState(false);
  const videoRef = React.useRef(null);

  const videoRefFunc = React.useCallback(
    (/** @type HTMLMediaElement */ ref) => {
      videoRef.current = ref;
      if (ref) {
        ref.srcObject = mediaStream;
        ref.play();
        setTimeout(() => setPlaying(true), 0); // TODO: mount check?
      }
    },
    [mediaStream]
  );

  const volume = React.useMemo(() => {
    if (muted) {
      return 0;
    }

    const l = location;
    const m = listenerLocation;
    const d = Math.sqrt(Math.pow(m[0] - l[0], 2) + Math.pow(m[1] - l[1], 2));
    const v = Math.min(
      Math.max(Math.pow(1 - d / window.innerWidth, 2.0), 0.0),
      1.0
    );
    return v;
  }, [muted, location, listenerLocation]);

  React.useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = volume;
    }
  }, [volume]);

  const springStyles = useSpring({
    transform: `translate3d(${location[0]}px, ${location[1]}px, 0) translate3d(-50%, -50%, 0)`,
    config: springConfig.stiff
  });

  return (
    <animated.div
      className={cx(styles.Avatar, playing && styles.avatarVideo)}
      style={springStyles}
    >
      <div className={styles.avatarInset}>
        <video ref={videoRefFunc} muted={muted} autoPlay />
        <div className={styles.avatarVolume}>{Math.ceil(volume * 100)}</div>
      </div>
    </animated.div>
  );
}

function PeerAvatar({
  localMediaStream,
  localLocation,
  initiator,
  onSendSignal,
  onCreatePeer,
  onDestroyPeer
}) {
  const [peer, setPeer] = React.useState(null);
  const [peerMediaStream, setPeerMediaStream] = React.useState(null);
  const [peerLocation, setPeerLocation] = React.useState(() => {
    // Randomly outside grid?
    return [
      Math.random() * window.innerWidth,
      Math.random() * window.innerHeight
    ];
  });

  const createPeer = React.useCallback(() => {
    const newPeer = new Peer({
      initiator,
      trickle: true,
      stream: localMediaStream
    });

    newPeer.on("signal", (signal) => {
      console.log("avatar peer signal", signal);
      onSendSignal(signal);
    });

    newPeer.on("connect", () => {
      setPeer(newPeer);
    });

    newPeer.on("stream", (stream) => {
      console.log("avatar peer stream");
      setPeerMediaStream(stream);
    });

    newPeer.on("track", (track) => {
      console.log("avatar peer track", track);
    });

    newPeer.on("data", (payload) => {
      const data = JSON.parse(payload);
      if (data.type === "location") {
        console.log("LOCATION", data);
        setPeerLocation(data.location);
      }
    });

    newPeer.on("error", () => {
      setPeer(null);
      onDestroyPeer();
    });

    newPeer.on("close", () => {
      setPeer(null);
      onDestroyPeer();
    });

    onCreatePeer(newPeer);
  }, [localMediaStream, initiator, onSendSignal, onCreatePeer, onDestroyPeer]);

  React.useEffect(() => {
    createPeer();
  }, [createPeer]);

  React.useEffect(() => {
    if (!peer) {
      return;
    }

    const payload = { type: "location", location: localLocation };
    peer.send(JSON.stringify(payload));
  }, [peer, localLocation]);

  React.useEffect(() => {
    return () => {
      if (peer) {
        peer.destroy();
      }
    };
  }, [peer]);

  return (
    <Avatar
      mediaStream={peerMediaStream}
      location={peerLocation}
      listenerLocation={localLocation}
      muted={false}
    />
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
  const [peerTracker, setPeerTracker] = React.useState(null);

  React.useEffect(() => {
    const interval = setInterval(() => {
      if (peerTracker) {
        console.log("requesting more peers");
        peerTracker.requestMorePeers();
      }
    }, 3000);

    return () => {
      clearInterval(interval);
    };
  }, [peerTracker]);

  const [location, setLocation] = React.useState(() => [
    window.innerWidth / 2,
    window.innerHeight / 2
  ]);

  const { mediaStream, error: mediaError } = useMediaStream({
    video: true,
    audio: true
  });

  const [avatars, updateAvatars] = useImmer({});

  const handleJoin = React.useCallback(() => {
    const room = window.location.hash || "general";

    let announceURLs = [
      "wss://tracker.openwebtorrent.com"
      // Connections fail:
      // "wss://tracker.sloppyta.co:443/announce",
      // "wss://tracker.novage.com.ua:443/announce"
      // "wss://tracker.btorrent.xyz:443/announce"
    ];

    const p2pt = new P2PT(announceURLs, "webrtc-locality-" + room);
    const msgHandlers = {};

    p2pt.on("peerconnect", (signalingPeer) => {
      console.log("peerconnect");

      let avatarPeer = null;
      let signalBuf = null;

      const handleSendSignal = (signal) => {
        console.log("signal", signal);
        p2pt.send(signalingPeer, {
          type: "signal",
          signal
        });
      };

      const handleRecieveMsgSignal = (msgPeer, msg) => {
        console.log("msg", msgPeer, msg);
        // Reject messages for other peers, since this is a common bus
        if (msgPeer.id !== signalingPeer.id || msg.type !== "signal") {
          return;
        }

        if (!avatarPeer) {
          signalBuf = msg.signal;
          return;
        }

        avatarPeer.signal(msg.signal);
      };

      const handleCreatePeer = (newPeer) => {
        console.log("handleCreatePeer");
        avatarPeer = newPeer;

        if (signalBuf) {
          avatarPeer.signal(signalBuf);
          signalBuf = null;
        }

        updateAvatars((draftAvatars) => {
          const avatar = draftAvatars[signalingPeer.id];
          if (avatar) {
            avatar.connected = true;
          }
        });
      };

      const handleDestroyPeer = () => {
        console.log("handleDestroyPeer");
        avatarPeer = null;
        signalBuf = null;

        updateAvatars((draftAvatars) => {
          const avatar = draftAvatars[signalingPeer.id];
          if (avatar) {
            avatar.connected = false;
          }
        });
      };

      msgHandlers[signalingPeer.id] = handleRecieveMsgSignal;
      p2pt.on("msg", handleRecieveMsgSignal);

      updateAvatars((draftAvatars) => {
        draftAvatars[signalingPeer.id] = {
          signalingPeer,
          connected: false,
          onSendSignal: handleSendSignal,
          onCreatePeer: handleCreatePeer,
          onDestroyPeer: handleDestroyPeer
        };
      });
    });

    p2pt.on("peerclose", (signalingPeer) => {
      console.log("peerclose");

      // p2pt does not have an off() method
      p2pt.removeListener("msg", msgHandlers[signalingPeer.id]);

      updateAvatars((draftAvatars) => {
        delete draftAvatars[signalingPeer.id];
      });
    });

    p2pt.start();

    setPeerTracker(p2pt);
  }, [updateAvatars]);

  const handleChooseLocation = (location) => {
    setLocation(location);
  };

  React.useEffect(handleJoin, [handleJoin]);

  if (mediaError) {
    return (
      <div>
        Media Permissions
        <br />
        {mediaError.toString()}
      </div>
    );
  }

  return (
    <>
      <Avatars>
        {Object.values(avatars).map((avatar) => (
          <PeerAvatar
            key={avatar.signalingPeer.id}
            localMediaStream={mediaStream}
            localLocation={location}
            initiator={avatar.signalingPeer.initiator}
            onSendSignal={avatar.onSendSignal}
            onCreatePeer={avatar.onCreatePeer}
            onDestroyPeer={avatar.onDestroyPeer}
          />
        ))}

        <Avatar
          mediaStream={mediaStream}
          location={location}
          listenerLocation={location}
          muted
        />
      </Avatars>

      <HUD onChooseLocation={handleChooseLocation}>
        <button
          type="button"
          style={{ position: "absolute", left: "0", top: "0" }}
          disabled={!!peerTracker}
          onClick={handleJoin}
        >
          Join
        </button>
      </HUD>
    </>
  );
}
