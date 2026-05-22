import { BrowserRouter, Routes, Route } from "react-router-dom";
import ProtectedLayout from "./layouts/ProtectedLayout";
import Home from "./pages/Home";
import Room from "./pages/Room";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<ProtectedLayout />}>
          <Route path="/" element={<Home />} />
          <Route path="/room/:code" element={<Room />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}