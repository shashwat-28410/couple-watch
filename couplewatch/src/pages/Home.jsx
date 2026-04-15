import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";

export default function Home() {
  const navigate = useNavigate();

  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [roomCodeInput, setRoomCodeInput] = useState("");

  function generateRoomCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  }

  // =========================
  // CREATE ROOM (HOST FLOW)
  // =========================
  async function handleStartWatching() {
    if (loading) return;

    setMsg("");
    setLoading(true);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) throw new Error("User not authenticated.");

      const roomCode = generateRoomCode();

      // 1️⃣ Create room
      const { data: room, error: roomError } = await supabase
        .from("rooms")
        .insert([
          {
            room_code: roomCode,
            created_by: user.id,
            title: "Movie Night 💜",
          },
        ])
        .select()
        .single();

      if (roomError) throw roomError;

      // 2️⃣ Insert membership as host
      const { error: memberError } = await supabase
        .from("room_members")
        .insert([
          {
            room_id: room.id,
            user_id: user.id,
            role: "host",
          },
        ]);

      if (memberError) {
        if (memberError.message.includes("duplicate")) {
          setMsg("⚠️ You are already in a room.");
          setLoading(false);
          return;
        }
        throw memberError;
      }

      // 3️⃣ Insert initial room_state row
      const { error: stateError } = await supabase
        .from("room_state")
        .insert([
          {
            room_id: room.id,
            is_playing: false,
            current_timestamp_seconds: 0,
          },
        ]);

      if (stateError) throw stateError;

      // 4️⃣ Redirect to room
      navigate(`/room/${room.room_code}`);
    } catch (err) {
      console.error("Create Room Error:", err);
      setMsg("❌ " + (err.message || "Something went wrong"));
    } finally {
      setLoading(false);
    }
  }

  // =========================
  // JOIN ROOM
  // =========================
  async function handleJoinRoom() {
    if (loading) return;

    setMsg("");
    setLoading(true);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) throw new Error("User not authenticated.");

      const code = roomCodeInput.trim().toUpperCase();

      if (!code) {
        setMsg("❌ Please enter a room code.");
        setLoading(false);
        return;
      }

      // 1️⃣ Find room
      const { data: room, error: roomError } = await supabase
        .from("rooms")
        .select("*")
        .eq("room_code", code)
        .single();

      if (roomError || !room) {
        setMsg("❌ Room not found.");
        setLoading(false);
        return;
      }

      // 2️⃣ Insert membership
      const { error: memberError } = await supabase
        .from("room_members")
        .insert([
          {
            room_id: room.id,
            user_id: user.id,
            role: "member",
          },
        ]);

      if (memberError) {
        if (memberError.message.includes("duplicate")) {
          setMsg("⚠️ You are already in a room.");
          setLoading(false);
          return;
        }
        throw memberError;
      }

      // 3️⃣ Redirect
      navigate(`/room/${room.room_code}`);
    } catch (err) {
      console.error("Join Room Error:", err);
      setMsg("❌ " + (err.message || "Something went wrong"));
    } finally {
      setLoading(false);
    }
  }

  // =========================
  // LOGOUT
  // =========================
  async function handleLogout() {
    await supabase.auth.signOut();
    window.location.reload();
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#0b0b15] via-[#0c0c1c] to-[#0a0a12] text-white px-6">
      <div className="text-center max-w-2xl">
        <h1 className="text-5xl font-bold text-purple-400 mb-4">
          CoupleWatch
        </h1>

        <p className="text-gray-300 text-lg mb-8">
          Watch together, wherever you are. Sync videos, chat in real-time, and
          feel close — even miles apart 💜
        </p>

        {/* Start Watching */}
        <button
          onClick={handleStartWatching}
          disabled={loading}
          className="px-8 py-3 rounded-xl bg-gradient-to-r from-purple-500 to-pink-500 hover:opacity-90 transition font-semibold"
        >
          {loading ? "Working..." : "Start Watching Now"}
        </button>

        {/* Join Section */}
        <div className="mt-6 flex gap-3 justify-center items-center">
          <input
            value={roomCodeInput}
            onChange={(e) => setRoomCodeInput(e.target.value)}
            placeholder="ENTER ROOM CODE"
            className="w-52 px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white outline-none uppercase placeholder:text-white/40"
          />
          <button
            onClick={handleJoinRoom}
            disabled={loading}
            className="px-6 py-3 rounded-xl bg-white/10 border border-white/20 hover:bg-white/20 transition font-semibold"
          >
            Join
          </button>
        </div>

        {/* Logout */}
        <div className="mt-6 flex justify-center">
          <button
            onClick={handleLogout}
            className="px-6 py-3 rounded-xl bg-white/10 border border-white/20 hover:bg-white/20 transition font-semibold"
          >
            Logout
          </button>
        </div>

        {msg && <p className="mt-6 text-red-400 font-medium">{msg}</p>}
      </div>
    </div>
  );
}