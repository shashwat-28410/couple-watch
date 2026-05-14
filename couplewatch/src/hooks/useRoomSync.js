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
        
        const { data: prof } = await supabase.from("profiles").select("full_name").eq("id", authUser.id).single();
        if (prof) setProfile(prof);

        const { data: roomData } = await supabase.from("rooms").select("*").eq("room_code", code).single();
        if (!roomData) { navigate("/", { replace: true }); return; }
        setRoom(roomData);

        const { data: existingMember } = await supabase.from("room_members")
          .select("*")
          .eq("room_id", roomData.id)
          .eq("user_id", authUser.id)
          .maybeSingle();

        if (!existingMember) {
          await supabase.from("room_members").insert([{ 
            room_id: roomData.id, 
            user_id: authUser.id, 
            role: roomData.created_by === authUser.id ? "host" : "member" 
          }]);
        }

        const [stateRes, membersRes] = await Promise.all([
          supabase.from("room_state").select("*").eq("room_id", roomData.id).maybeSingle(),
          supabase.from("room_members").select("id, role, user_id, profiles(full_name)").eq("room_id", roomData.id)
        ]);

        if (stateRes.data) setRoomState(stateRes.data);
        
        let hostStatus = false;
        if (membersRes.data) {
          setMembers(membersRes.data);
          const current = membersRes.data.find(m => m.user_id === authUser.id);
          if (current) hostStatus = current.role === "host";
        }
        if (!hostStatus && roomData.created_by === authUser.id) hostStatus = true;
        
        setIsHost(hostStatus);
        isHostRef.current = hostStatus;
        setIsInitializing(false);
      } catch (err) {
        console.error("Init Room Error:", err);
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
