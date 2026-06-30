import React, { useMemo } from "react";

export function CalendarGrid({ lessons = [], selectedLessonId, onSelect }) {
  const weekDays = useMemo(() => {
    const current = new Date();
    const week = [];
    const day = current.getDay();
    // Monday is first day (1), Sunday is 0 (map to Monday - 6 days)
    const distance = day === 0 ? -6 : 1 - day;
    const monday = new Date(current.setDate(current.getDate() + distance));
    
    const weekNames = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
    for (let i = 0; i < 7; i++) {
      const date = new Date(monday);
      date.setDate(monday.getDate() + i);
      const mm = String(date.getMonth() + 1).padStart(2, "0");
      const dd = String(date.getDate()).padStart(2, "0");
      week.push(`${weekNames[i]}\n${mm}/${dd}`);
    }
    return week;
  }, []);

  const DEFAULT_HOURS = ["09:00", "10:30", "14:00", "16:00", "19:00"];
  const hours = useMemo(() => {
    const starts = (lessons || []).map((l) => l.start).filter(Boolean);
    return Array.from(new Set([...DEFAULT_HOURS, ...starts])).sort();
  }, [lessons]);

  const isCurrentTimeSlot = (hour, dayIndex) => {
    const now = new Date();
    const currentDayIndex = now.getDay() === 0 ? 6 : now.getDay() - 1;
    if (currentDayIndex !== dayIndex) return false;
    
    const parts = hour.split(":");
    if (parts.length < 2) return false;
    const [slotH, slotM] = parts.map(Number);
    const nowH = now.getHours();
    const nowM = now.getMinutes();
    const slotMinutes = slotH * 60 + slotM;
    const nowMinutes = nowH * 60 + nowM;
    
    // Check if the current time is within +/- 45 minutes of the slot start
    return Math.abs(nowMinutes - slotMinutes) < 45;
  };

  return (
    <>
      <div className="week-grid">
        <div className="calendar-corner" />
        {weekDays.map((day) => (
          <div className="day-head" key={day}>
            {day.split("\n").map((part) => <span key={part}>{part}</span>)}
          </div>
        ))}
        {hours.map((hour) => (
          <div className="hour-row" key={hour}>
            <div className="hour-label">{hour}</div>
            {Array.from({ length: 7 }).map((_, day) => {
              const cellLessons = (lessons || []).filter(
                (lesson) => lesson.day === day && lesson.start === hour,
              );
              return (
                <div className="calendar-cell" key={`${hour}-${day}`}>
                  {isCurrentTimeSlot(hour, day) ? <span className="now-line" /> : null}
                  {cellLessons.map((lesson) => (
                    <button
                      key={lesson.id}
                      className={`lesson-chip ${lesson.color} ${lesson.id === selectedLessonId ? "is-selected" : ""}`}
                      type="button"
                      onClick={() => onSelect(lesson.id)}
                    >
                      <strong>{lesson.title}</strong>
                      <span>{lesson.studentName}</span>
                      <small>{lesson.teacher} · {lesson.room}</small>
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div className="legend">
        <span><i className="legend-dot green" />一对一</span>
        <span><i className="legend-dot orange" />小组课</span>
        <span><i className="legend-dot purple" />固定班</span>
      </div>
    </>
  );
}
