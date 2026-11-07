export const publicDemo = import.meta.env.VITE_DEMO_MODE === "true";
export const canIndexDemo = import.meta.env.DEV && !publicDemo;
export const demoAvailable = publicDemo || import.meta.env.DEV;
