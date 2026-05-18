import { useState, useEffect } from "react";

export function FloatingHearts() {
  const [hearts, setHearts] = useState([]);
  useEffect(() => {
    const newHearts = Array.from({ length: 15 }).map((_, i) => ({
      id: i,
      left: Math.random() * 100 + "%",
      delay: Math.random() * 15 + "s",
      duration: 10 + Math.random() * 10 + "s",
      size: 10 + Math.random() * 20 + "px"
    }));
    setHearts(newHearts);
  }, []);

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {hearts.map(h => (
        <span key={h.id} className="heart-particle" style={{ left: h.left, animationDelay: h.delay, animationDuration: h.duration, fontSize: h.size }}>♡</span>
      ))}
    </div>
  );
}
