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

        const { data: roomData } = await supabase.from("rooms").select("*").eq("room_code", code).maybeSingle();
        if (!roomData) { 
          navigate("/?error=Room%20not%20found%20or%20already%20deleted", { replace: true }); 
          return; 
        }

        const [stateRes, membersRes] = await Promise.all([
          supabase.from("room_state").select("*").eq("room_id", roomData.id).maybeSingle(),
          supabase.from("room_members").select("id, role, user_id").eq("room_id", roomData.id)
        ]);

        // Check if room has been abandoned / inactive for over 1 hour
        const lastActiveTime = stateRes.data?.updated_at || roomData.created_at;
        const ONE_HOUR_MS = 60 * 60 * 1000;
        if (lastActiveTime && (Date.now() - new Date(lastActiveTime).getTime() > ONE_HOUR_MS)) {
          // Room expired: clean up all records and redirect
          await Promise.all([
            supabase.from("messages").delete().eq("room_id", roomData.id),
            supabase.from("room_memories").delete().eq("room_id", roomData.id),
            supabase.from("room_members").delete().eq("room_id", roomData.id),
            supabase.from("room_state").delete().eq("room_id", roomData.id)
          ]).catch(() => {});
          await supabase.from("rooms").delete().eq("id", roomData.id).catch(() => {});

          navigate("/?error=This%20room%20was%20deleted%20after%201%20hour%20of%20inactivity", { replace: true });
          return;
        }

        // Room is valid & active: refresh active timestamp
        await supabase
          .from("room_state")
          .update({ updated_at: new Date().toISOString() })
          .eq("room_id", roomData.id)
          .catch(() => {});

        setRoom(roomData);

        // Feature: Upsert member to avoid 409 conflict
        await supabase.from("room_members").upsert([{ 
          room_id: roomData.id, 
          user_id: authUser.id, 
          role: roomData.created_by === authUser.id ? "host" : "member" 
        }]);

        if (stateRes.data) setRoomState(stateRes.data);
        
        let hostStatus = false;
        if (membersRes.data) {
          const userIds = membersRes.data.map(m => m.user_id);
          const { data: profiles } = await supabase.from("profiles").select("id, full_name").in("id", userIds);
          
          const enrichedMembers = membersRes.data.map(m => ({
            ...m,
            profiles: profiles?.find(p => p.id === m.user_id) || { full_name: "Partner" }
          }));
          
          setMembers(enrichedMembers);
          const current = enrichedMembers.find(m => m.user_id === authUser.id);
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
    setIsHost,
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
