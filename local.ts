import { app } from "./src/app";

const PORT = Number(process.env.PORT || 3000);

app.listen(PORT, () => {
  console.log(`🥋 Coding Dojo local server running on http://localhost:${PORT}`);
});
