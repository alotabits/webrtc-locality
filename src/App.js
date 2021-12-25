import React from "react";
import ReactDOM from "react-dom";
import cx from "clsx";
import styles from "./App.module.css";
import { faPhone, faSpinner } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";

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
  dataChannel: propsDataChannel,
  mediaStream,
  muted,
  location: propsLocation,
  micLocation
}) {
  const [playing, setPlaying] = React.useState(false);
  const videoRef = React.useRef(null);

  const [stateLocation, setStateLocation] = React.useState(() => [
    Math.random() * window.innerWidth,
    Math.random() * window.innerHeight
  ]);

  const location = propsLocation || stateLocation;
  const dataChannel = usePromise(propsDataChannel);

  React.useEffect(() => {
    if (dataChannel) {
      dataChannel.addEventListener("message", (e) => {
        const data = JSON.parse(e.data);
        console.log("LOCATION", data);
        setStateLocation(data);
      });
    }
  }, [dataChannel]);

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
    const l = location;
    const m = micLocation || location;
    const d = Math.sqrt(Math.pow(m[0] - l[0], 2) + Math.pow(m[1] - l[1], 2));
    const v = muted
      ? 0
      : Math.min(Math.max(Math.pow(1 - d / window.innerWidth, 2.0), 0.0), 1.0);
    return v;
  }, [location, micLocation, muted]);

  React.useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = volume;
    }
  }, [volume]);

  const transform = `translate(${location[0]}px, ${location[1]}px) translate(-50%, -50%)`;

  return (
    <div
      className={cx(styles.Avatar, playing && styles.avatarVideo)}
      style={{ transform }}
    >
      <div className={styles.avatarInset}>
        <video ref={videoRefFunc} muted={muted} autoPlay />
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
  const [location, setLocation] = React.useState(() => [
    window.innerWidth / 2,
    window.innerHeight / 2
  ]);
  const { mediaStream } = useMediaStream({
    video: true,
    audio: true
  });

  const [peers, setPeers] = React.useState([]);

  const handleConnect = (/** @type RTCPeerConnection */ peerConn) => {
    console.log("CONNECTED", peerConn);

    const mediaStream = new MediaStream(
      peerConn.getReceivers().map((receiver) => receiver.track)
    );

    setPeers((prevPeers) => [
      ...prevPeers,
      {
        peerConn,
        mediaStream
      }
    ]);

    peerConn.addEventListener("connectionstatechange", (event) => {
      switch (event.target.connectionState) {
        case "connected":
          // The connection has become fully connected
          break;
        case "disconnected":
        case "failed":
          // One or more transports has terminated unexpectedly or in an error
          setPeers((peers) =>
            peers.filter((peer) => peer.mediaStream.id !== mediaStream.id)
          );
          break;
        case "closed":
          // The connection has been closed
          setPeers((peers) =>
            peers.filter((peer) => peer.mediaStream.id !== mediaStream.id)
          );
          break;
        default:
          break;
      }
    });
  };

  const handleChooseLocation = (location) => {
    peers.forEach(async (peer) => {
      debugger;
      // TODO: Failed to execute 'send' on 'RTCDataChannel': RTCDataChannel.readyState is not 'open'
      (await peer.peerConn.dataChannel).send(JSON.stringify(location));
    });
    setLocation(location);
  };

  return (
    <>
      <Avatars>
        {peers.map((peer) => (
          <Avatar
            key={peer.mediaStream.id}
            dataChannel={peer.peerConn.dataChannel}
            mediaStream={peer.mediaStream}
            micLocation={location}
          />
        ))}

        <Avatar mediaStream={mediaStream} location={location} muted />
      </Avatars>

      <HUD onChooseLocation={handleChooseLocation}>
        <CallButton mediaStream={mediaStream} onConnect={handleConnect} />
        <AnswerButton mediaStream={mediaStream} onConnect={handleConnect} />
      </HUD>
    </>
  );
}
