import { app } from "./src/app";

const PORT = Number(process.env.PORT || 3000);

app.listen(PORT, () => {
  console.log(`Coding Dojo running on http://localhost:${PORT}`);
});
