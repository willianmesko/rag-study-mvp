import { useEffect, useRef } from "react";
import { useBrowserLocation } from "../../shared/lib/browser-location";

export function useApplicationLocation() {
  const location = useBrowserLocation();
  const path = location.split("?")[0];
  const previous = useRef(path);
  useEffect(() => {
    if (previous.current !== path) window.scrollTo(0, 0);
    previous.current = path;
  }, [path]);
  return location;
}
