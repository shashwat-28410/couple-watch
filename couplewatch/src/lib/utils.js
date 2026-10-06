import { supabase } from "./supabaseClient";

export const ensureUserProfile = async (authUser) => {
  if (!authUser?.id) return null;
  try {
    const { data: existing } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .eq("id", authUser.id)
      .maybeSingle();

    if (existing) return existing;

    const name =
      authUser.user_metadata?.full_name ||
      authUser.user_metadata?.name ||
      authUser.email?.split("@")[0] ||
      "User";

    const { data: inserted, error } = await supabase
      .from("profiles")
      .upsert(
        [
          {
            id: authUser.id,
            email: authUser.email,
            full_name: name,
          },
        ],
        { onConflict: "id" }
      )
      .select()
      .maybeSingle();

    if (error) {
      console.warn("Could not upsert profile:", error.message);
    }
    return inserted || { id: authUser.id, full_name: name, email: authUser.email };
  } catch (err) {
    console.warn("ensureUserProfile error:", err);
    return null;
  }
};

export const formatVideoUrl = (url) => {
  if (!url) return url;
  let formatted = url.trim();
  
  // Force HTTPS
  if (formatted.startsWith("http://")) {
    formatted = formatted.replace("http://", "https://");
  }

  // Dropbox Handling
  if (formatted.includes("dropbox.com")) {
    formatted = formatted
      .replace("www.dropbox.com", "dl.dropboxusercontent.com")
      .replace("?dl=0", "")
      .replace("?dl=1", "");
    
    if (!formatted.includes("?")) {
      formatted += "?raw=1";
    } else if (!formatted.includes("raw=1")) {
      formatted += "&raw=1";
    }
  }

  // Google Drive Handling
  if (formatted.includes("drive.google.com") || formatted.includes("docs.google.com")) {
    const match = formatted.match(/[-\w]{25,}/);
    if (match) {
      formatted = `https://docs.google.com/uc?export=download&id=${match[0]}`;
    }
  }

  return formatted;
};
