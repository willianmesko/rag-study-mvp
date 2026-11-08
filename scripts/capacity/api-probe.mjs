import { createEventLoopProbe } from "./event-loop-probe.mjs";
import { createCheckoutProbe } from "./checkout-probe.mjs";

// Only the lab command loads this file, on its internal bridge without host ports.
createEventLoopProbe({ checkout: createCheckoutProbe() }).listen(3001, "0.0.0.0");
