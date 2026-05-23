import { useState, useEffect, useRef } from "react";
import { supabase } from "../lib/supabaseClient";

export function useChat(room, user, connectionStatus, channelRef, profile) {
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState("");
  const isTypingRef = useRef(false);
  const typingTimeoutRef = useRef(null);

  useEffect(() => {
    if (!room?.id) return;
    async function fetchMessages() {
      const { data } = await supabase
        .from("messages")
        .select("id, content, created_at, user_id, profiles(full_name)")
        .eq("room_id", room.id)
        .order("created_at", { ascending: true })
        .limit(50);
      if (data) setMessages(data);
    }
    fetchMessages();
  }, [room?.id]);

  const handleSendMessage = async (e) => {
    if (e) e.preventDefault();
    if (!newMessage.trim() || !user || !room) return;
    
    const content = newMessage.trim();
    setNewMessage("");

    const { data } = await supabase.from("messages").insert([{ 
      room_id: room.id, 
      user_id: user.id, 
      content 
    }]).select().single();

    if (data) {
      const fullMsg = { ...data, profiles: profile || { full_name: user.email?.split('@')[0] } };
      setMessages(current => [...current, fullMsg]);
      
      if (channelRef.current && connectionStatus === "SUBSCRIBED") {
        channelRef.current.send({ type: "broadcast", event: "chat-msg", payload: fullMsg });
      }
    }
  };

  const handleTyping = async () => {
    if (!channelRef.current || !user || connectionStatus !== "SUBSCRIBED") return;
    
    if (!isTypingRef.current) {
      isTypingRef.current = true;
      channelRef.current.track({ 
        online_at: new Date().toISOString(), 
        is_typing: true, 
        full_name: profile?.full_name || user.email?.split('@')[0]
      });
    }

    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(async () => {
      isTypingRef.current = false;
      if (channelRef.current) {
        channelRef.current.track({ 
          online_at: new Date().toISOString(), 
          is_typing: false, 
          full_name: profile?.full_name || user.email?.split('@')[0]
        });
      }
    }, 3000);
  };

  return {
    messages,
    setMessages,
    newMessage,
    setNewMessage,
    handleSendMessage,
    handleTyping
  };
}
