import { createRoot } from "react-dom/client"

import Popup from "../popup"

const root = document.getElementById("root")
if (!root) throw new Error("Missing extension root")
createRoot(root).render(<Popup />)
