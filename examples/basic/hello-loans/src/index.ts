import { createServer } from "./server.js";

const port = Number(process.env.PORT ?? 3000);
const app = createServer();
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ level: "info", msg: "hello-loans listening", port }));
});
