import React from "react";
import ReactDOM from "react-dom";
import cx from "clsx";
import styles from "./App.module.css";
import { faPhone, faSpinner } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useMediaStream, useViewport } from "./hooks";
import { useImmer } from "use-immer";
import {
  animated,
  useSpring,
  config as springConfig,
  useTransition
} from "react-spring";

const Peer = window.SimplePeer;
const P2PT = window.P2PT;

function Avatars({ children }) {
  return (
    <div className={[styles.Avatars]} style={{ pointerEvents: "none" }}>
      {children}
    </div>
  );
}

function Avatar({ name, mediaStream, location, listenerLocation, muted }) {
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
      Math.max(
        Math.pow(1 - d / document.documentElement.clientWidth, 2.0),
        0.0
      ),
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
        <video ref={videoRefFunc} muted={muted} autoPlay playsInline />
        <div className={styles.avatarVolume}>
          {name} {Math.ceil(volume * 100)}
        </div>
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
      Math.random() * document.documentElement.clientWidth,
      Math.random() * document.documentElement.clientHeight
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

  /*
  React.useEffect(() => {
    return () => {
      if (peer) {
        peer.destroy();
      }
    };
  }, [peer]);
  */

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

const JoinForm = ({ style, disabled, onJoin }) => {
  const [name, setName] = React.useState("");

  return (
    <div className={styles.JoinForm} style={style}>
      <div className={styles.joinField}>
        <input
          placeholder="Name"
          type="text"
          disabled={disabled}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div>
        <button type="button" disabled={disabled} onClick={() => onJoin(name)}>
          Join
        </button>
      </div>
    </div>
  );
};

const AnimatedJoinForm = animated(JoinForm);

export default function App() {
  const [peerTracker, setPeerTracker] = React.useState(null);
  const [localName, setLocalName] = React.useState(null);

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

  const viewport = useViewport();

  const [location, setLocation] = React.useState(() => [
    viewport.width / 2,
    viewport.height / 2
  ]);

  const { mediaStream, error: mediaError } = useMediaStream({
    video: true,
    audio: true
  });

  const [avatars, updateAvatars] = useImmer({});

  const handleCreateAvatar = React.useCallback(
    (signalingPeer, handlers) => {
      updateAvatars((draftAvatars) => {
        draftAvatars[signalingPeer.id] = {
          signalingPeer,
          onSendSignal: handlers.handleSendSignal,
          onCreatePeer: handlers.handleCreatePeer,
          onDestroyPeer: handlers.handleDestroyPeer
        };
      });
    },
    [updateAvatars]
  );

  const handleDestroyAvatar = React.useCallback(
    (signalingPeer) => {
      updateAvatars((draftAvatars) => {
        delete draftAvatars[signalingPeer.id];
      });
    },
    [updateAvatars]
  );

  const handleJoin = React.useCallback(
    (joinName) => {
      setLocalName(joinName);

      const room = window.location.hash || "general";

      let announceURLs = [
        "wss://tracker.openwebtorrent.com"
        // Connections fail:
        // "wss://tracker.sloppyta.co:443/announce",
        // "wss://tracker.novage.com.ua:443/announce"
        // "wss://tracker.btorrent.xyz:443/announce"
      ];

      const p2pt = new P2PT(announceURLs, "webrtc-locality-" + room);
      const peerHandlers = new Map();

      p2pt.on("peerconnect", (signalingPeer) => {
        console.log("peerconnect");

        const handlers = {
          handleSendSignal(signal) {
            console.log("signal", signal);
            p2pt.send(signalingPeer, {
              type: "signal",
              signal
            });
          },
          handleCreatePeer(newPeer) {
            console.log("handleCreatePeer");
            peerHandlers.get(signalingPeer.id).avatarPeer = newPeer;
          },
          handleDestroyPeer() {
            console.log("handleDestroyPeer");
            peerHandlers.get(signalingPeer.id).avatarPeer = null;
          }
        };

        peerHandlers.set(signalingPeer.id, handlers);

        if (signalingPeer.initiator) {
          p2pt.send(signalingPeer, {
            type: "init",
            init: { name: joinName }
          });
        }

        handleCreateAvatar(signalingPeer, handlers);
      });

      p2pt.on("msg", (signalingPeer, msg) => {
        console.log("msg", signalingPeer, msg);

        if (msg.type === "signal") {
          const handler = peerHandlers.get(signalingPeer.id);
          const avatarPeer = handler?.avatarPeer;

          if (avatarPeer) {
            avatarPeer.signal(msg.signal);
          } else {
            console.warn(
              `dropped signal coming from ${signalingPeer.id} with value ${msg.signal}`
            );
          }
        } else if (msg.type === "init") {
          const handler = peerHandlers.get(signalingPeer.id);

          if (handler) {
            handler.ready = true;
            handler.name = msg.init.name;
            if (!signalingPeer.initiator) {
              p2pt.send(signalingPeer, {
                type: "init",
                init: { name: joinName }
              });
            }
          } else {
            console.warn(
              `dropped init coming from ${signalingPeer.id} with value ${msg.init}`
            );
          }
        }
      });

      p2pt.on("peerclose", (signalingPeer) => {
        console.log("peerclose");

        peerHandlers.delete(signalingPeer.id);

        handleDestroyAvatar(signalingPeer);
      });

      p2pt.start();

      setPeerTracker(p2pt);
    },
    [handleCreateAvatar, handleDestroyAvatar]
  );

  const handleChooseLocation = (location) => {
    setLocation(location);
  };

  //React.useEffect(() => handleJoin("Josh"), [handleJoin]);

  const transitions = useTransition(!peerTracker, {
    enter: {
      opacity: 1
    },
    leave: {
      opacity: 0
    }
  });
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
      <HUD onChooseLocation={handleChooseLocation}></HUD>
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
          name={localName}
          mediaStream={mediaStream}
          location={location}
          listenerLocation={location}
          muted
        />
      </Avatars>
      {transitions(
        (stylez, item) =>
          item && (
            <AnimatedJoinForm
              style={{ opacity: stylez.opacity }}
              disabled={!!peerTracker}
              onJoin={handleJoin}
            />
          )
      )}
    </>
  );
}
