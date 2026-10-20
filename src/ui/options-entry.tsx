import { createRoot } from "react-dom/client"

import Options from "../options"

const root = document.getElementById("root")
if (!root) throw new Error("Missing extension root")
createRoot(root).render(<Options />)
