import './env.ts'
import { app } from './app.ts'

// Long-running server bootstrap (Render). The app itself lives in app.ts so
// tests can import it without this listen() call.
const PORT = Number(process.env.PORT) || 6060

app.listen(PORT, () => {
  console.log(`Slate server listening on http://localhost:${PORT}`)
})
