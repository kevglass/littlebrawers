import "./style.css";
import { Editor } from "./Editor";

const app = document.getElementById("app");
if (!app) throw new Error("#app element missing");

new Editor(app);
