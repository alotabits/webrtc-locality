import { useCallback, useEffect, useRef, useState } from "react";

// https://usehooks.com/useAsync/
export function useAsync(asyncFunction, { immediate = true }) {
  const [status, setStatus] = useState("idle");
  const [value, setValue] = useState(null);
  const [error, setError] = useState(null);

  // The execute function wraps asyncFunction and
  // handles setting state for pending, value, and error.
  // useCallback ensures the below useEffect is not called
  // on every render, but only if asyncFunction changes.
  const execute = useCallback(() => {
    setStatus("pending");
    setValue(null);
    setError(null);

    return asyncFunction()
      .then((response) => {
        setValue(response);
        setStatus("success");
      })
      .catch((error) => {
        setError(error);
        setStatus("error");
      });
  }, [asyncFunction]);

  // Call execute if we want to fire it right away.
  // Otherwise execute can be called later, such as
  // in an onClick handler.
  useEffect(() => {
    if (immediate) {
      execute();
    }
  }, [execute, immediate]);

  return { execute, status, value, error };
}

export function useAsyncEffect(effect, deps) {
  const isMounted = useMounted();
  const mountedFuncRef = useRef(() => isMounted);

  useEffect(() => {
    effect(mountedFuncRef.current);
  }, deps);
}

/**
 * @param {Object} args
 * @param {Boolean} args.video
 * @param {Boolean} args.audio
 */
export function useMediaStream({ video, audio }) {
  // Set a stable initState object in the ref.current
  // So a setState with that object when we're already in the initState will bail on re-render.
  const initState = useRef({
    mediaStream: null,
    error: null
  });

  const [state, setState] = useState(initState.current);

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

export function useMounted() {
  const ref = useRef(true);

  useEffect(
    () => () => {
      ref.current = false;
    },
    []
  );

  return ref.current;
}

export function usePrevious(value) {
  const ref = useRef(null);

  useEffect(() => {
    ref.current = value;
  }, [value]);

  return ref.current;
}

export function usePromise(promise, initState = null) {
  const [state, setState] = useState(initState);

  useEffect(() => {
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

export function useViewport() {
  const [viewport, setViewport] = useState(() => ({
    width: document.documentElement.clientWidth,
    height: document.documentElement.clientHeight
  }));

  useEffect(() => {
    const listener = window.addEventListener("resize", () => {
      setViewport({
        width: document.documentElement.clientWidth,
        height: document.documentElement.clientHeight
      });
    });

    return () => window.removeEventListener("resize", listener);
  }, []);

  return viewport;
}
