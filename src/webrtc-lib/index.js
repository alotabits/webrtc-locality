import React from "react";

// Handler for a React component with state.
const handleConnect = (/** @type RTCPeerConnection */ peerConn) => {
  console.log("CONNECTED", peerConn);

  const mediaStream = new MediaStream(
    peerConn.getReceivers().map((receiver) => receiver.track)
  );

  setPeers((prevPeers) => [
    ...prevPeers,
    {
      peerConn,
      mediaStream,
      sync: {
        stale: false
      }
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

export function AnswerButton({ mediaStream, onConnect }) {
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
