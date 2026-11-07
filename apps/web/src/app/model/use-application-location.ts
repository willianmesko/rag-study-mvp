import { useEffect, useState } from "react";

export function useApplicationLocation() {
  const [pathname, setPathname] = useState(() => window.location.pathname + window.location.search);
  useEffect(() => {
    const update = () => {
      setPathname(window.location.pathname + window.location.search);
      window.scrollTo(0, 0);
    };
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);
  return pathname;
}
