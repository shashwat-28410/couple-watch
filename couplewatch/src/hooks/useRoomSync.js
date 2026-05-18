import { useState, useEffect, useRef } from "react";
import { supabase } from "../lib/supabaseClient";

export function useRoomSync(user, code, navigate) {
  const [room, setRoom] = useState(null);
  const [roomState, setRoomState] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState("JOINING");
  const [isHost, setIsHost] = useState(false);
  const [members, setMembers] = useState([]);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [typingUsers, setTypingUsers] = useState([]);
  const [isInitializing, setIsInitializing] = useState(true);
  const [profile, setProfile] = useState(null);

  const channelRef = useRef(null);
  const isHostRef = useRef(false);
  const roomStateRef = useRef(null);

  useEffect(() => { roomStateRef.current = roomState; }, [roomState]);

  useEffect(() => {
    async function initRoom() {
      if (!code || !navigate) return;
      try {
        const { data: { user: authUser } } = await supabase.auth.getUser();
        if (!authUser) { navigate("/", { replace: true }); return; }

        // FAST PATH: Parallel fetch room, state, and profile
        const [roomRes, profileRes] = await Promise.all([
          supabase.from("rooms").select("*, room_state(*), room_members(id, role, user_id, profiles(full_name))").eq("room_code", code).single(),
          supabase.from("profiles").select("full_name").eq("id", authUser.id).single()
        ]);

        const roomData = roomRes.data;
        if (!roomData) { navigate("/", { replace: true }); return; }

        if (profileRes.data) setProfile(profileRes.data);
        setRoom(roomData);
        if (roomData.room_state?.[0]) setRoomState(roomData.room_state[0]);
        if (roomData.room_members) setMembers(roomData.room_members);

        const isUserHost = roomData.created_by === authUser.id;
        setIsHost(isUserHost);
        isHostRef.current = isUserHost;

        // Background: Ensure member entry exists (don't wait for it to join)
        const isAlreadyMember = roomData.room_members?.some(m => m.user_id === authUser.id);
        if (!isAlreadyMember) {
          supabase.from("room_members").insert([{ 
            room_id: roomData.id, 
            user_id: authUser.id, 
            role: isUserHost ? "host" : "member" 
          }]).then(() => {
             // Refresh members list silently
             supabase.from("room_members").select("id, role, user_id, profiles(full_name)").eq("room_id", roomData.id).then(res => {
               if (res.data) setMembers(res.data);
             });
          });
        }

        setIsInitializing(false);
      } catch (err) {
        console.error("Fast Join Error:", err);
        navigate("/", { replace: true });
      }
    }
    initRoom();
  }, [code, navigate]);

  const updateRoomState = async (newValues, forceJump = false) => {
    if (!isHostRef.current || !room?.id) return;
    setRoomState(prev => {
      const compensatedValues = { ...prev, ...newValues };
      if (channelRef.current && connectionStatus === "SUBSCRIBED") {
        channelRef.current.send({ 
          type: "broadcast", 
          event: "sync-event", 
          payload: { ...compensatedValues, force: forceJump } 
        });
      }
      return compensatedValues;
    });
    await supabase.from("room_state").update(newValues).eq("room_id", room.id);
  };

  return {
    room,
    roomState,
    setRoomState,
    connectionStatus,
    setConnectionStatus,
    isHost,
    members,
    setMembers,
    onlineUsers,
    setOnlineUsers,
    typingUsers,
    setTypingUsers,
    isInitializing,
    profile,
    channelRef,
    isHostRef,
    roomStateRef,
    updateRoomState
  };
}
