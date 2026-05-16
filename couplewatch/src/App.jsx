import { BrowserRouter, Routes, Route } from "react-router-dom";
import ProtectedLayout from "./layouts/ProtectedLayout";
import Home from "./pages/Home";
import Room from "./pages/Room";
import History from "./pages/History";
import JoinViaLink from "./pages/JoinViaLink";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<ProtectedLayout />}>
          <Route path="/" element={<Home />} />
          <Route path="/room/:code" element={<Room />} />
          <Route path="/history" element={<History />} />
          {/* Invite link route — outside auth gate; JoinViaLink handles its own auth check */}
        </Route>
        {/* Public invite link route — handles its own auth state */}
        <Route path="/join/:roomCode" element={<JoinViaLink />} />
      </Routes>
    </BrowserRouter>
  );
}