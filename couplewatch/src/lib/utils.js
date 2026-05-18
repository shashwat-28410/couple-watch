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
