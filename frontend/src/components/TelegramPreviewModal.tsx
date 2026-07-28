"use client";
import { createPortal } from "react-dom";

type FakeMsg = { from: "them" | "us"; text: string; time: string };

/** A visual prototype only -- there is no real Telegram bot wired to Argus
 * clients (see the "Скоро" note in ClientsPanel). This exists so the sales
 * team has something concrete to show the client when pitching the
 * eventual integration, not a working feature -- every message here is
 * fabricated, nothing is sent or stored. */
export function TelegramPreviewModal({ clientName, onClose }: { clientName: string; onClose: () => void }) {
  const firstName = clientName.split(" ")[0] || clientName;
  const messages: FakeMsg[] = [
    { from: "them", text: `Здравствуйте! Подскажите, актуальна ли квартира в Milano, которую я смотрел?`, time: "10:02" },
    { from: "us", text: `Добрый день, ${firstName}! Да, юнит ещё в продаже. Могу прислать актуальную справку с ценой и рассрочкой.`, time: "10:03" },
    { from: "us", text: `📄 Справка №1284 — Milano, рассрочка 12 мес`, time: "10:03" },
    { from: "them", text: "Отлично, спасибо! А можно чуть меньше первый взнос?", time: "10:05" },
    { from: "us", text: "Посмотрю варианты и вернусь с ответом сегодня до вечера.", time: "10:06" },
  ];

  return createPortal(
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center" }}
    >
      <div onClick={(e) => e.stopPropagation()} className="glass-panel section-enter" style={{ width: 380, maxWidth: "92vw", padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--color-hairline-soft)", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: "50%", background: "linear-gradient(150deg, #2AABEE, #229ED9)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <svg viewBox="0 0 24 24" width={18} height={18} fill="#fff"><path d="M21.94 4.53 18.6 20.2c-.25 1.12-.9 1.4-1.83.87l-5.06-3.73-2.44 2.35c-.27.27-.5.5-1.02.5l.36-5.15L18.1 6.9c.4-.36-.09-.56-.63-.2L7.4 13.3l-5-1.57c-1.1-.34-1.12-1.1.23-1.63L20.6 3.5c.9-.34 1.7.2 1.34 1.03Z" /></svg>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--color-text)" }}>{clientName}</div>
            <div style={{ fontSize: 10.5, color: "var(--color-text-faint)" }}>Telegram · онлайн</div>
          </div>
          <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: ".04em", color: "#fff", background: "linear-gradient(150deg, #2AABEE, #229ED9)", borderRadius: 99, padding: "3px 8px", flexShrink: 0 }}>
            БЕТА
          </span>
        </div>

        <div style={{ padding: "16px 14px", display: "flex", flexDirection: "column", gap: 8, background: "rgba(0,0,0,.15)" }}>
          {messages.map((m, i) => (
            <div key={i} style={{ display: "flex", justifyContent: m.from === "us" ? "flex-end" : "flex-start" }}>
              <div style={{
                maxWidth: "78%", padding: "8px 11px", borderRadius: m.from === "us" ? "12px 12px 3px 12px" : "12px 12px 12px 3px",
                background: m.from === "us" ? "#2AABEE" : "rgba(255,255,255,.08)",
                color: m.from === "us" ? "#fff" : "var(--color-text)",
                fontSize: 12.5, lineHeight: 1.4,
              }}>
                {m.text}
                <div style={{ fontSize: 9.5, opacity: 0.7, marginTop: 3, textAlign: "right" }}>{m.time}</div>
              </div>
            </div>
          ))}
        </div>

        <div style={{ padding: "12px 16px", borderTop: "1px solid var(--color-hairline-soft)" }}>
          <div style={{ fontSize: 11, color: "var(--color-text-faint)", lineHeight: 1.5 }}>
            Это визуальный прототип для демонстрации клиенту — реальные сообщения не отправляются и не сохраняются. Интеграция с Telegram ещё не подключена.
          </div>
          <button
            onClick={onClose}
            className="press"
            style={{ marginTop: 10, width: "100%", padding: "8px 0", borderRadius: 10, border: "none", background: "rgba(255,255,255,.06)", color: "var(--color-text-soft)", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}
          >
            Закрыть
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
