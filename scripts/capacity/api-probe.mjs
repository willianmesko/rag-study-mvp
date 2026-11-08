import { createEventLoopProbe } from "./event-loop-probe.mjs";

// Only the lab command loads this file, on its internal bridge without host ports.
createEventLoopProbe().listen(3001, "0.0.0.0");
