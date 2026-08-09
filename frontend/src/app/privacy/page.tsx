import Link from "next/link";

export const metadata = { title: "Argus — Политика конфиденциальности" };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginTop: 28 }}>
      <h2 style={{ fontFamily: "var(--font-heading)", fontSize: 16, fontWeight: 700, color: "var(--color-text)", margin: "0 0 10px" }}>
        {title}
      </h2>
      <div style={{ fontSize: 13.5, lineHeight: 1.7, color: "var(--color-text-soft)" }}>{children}</div>
    </section>
  );
}

/** Public, unauthenticated page -- no "use client", nothing here depends on
 * the logged-in session. Content is grounded in what Argus actually does
 * (Google OAuth, Supabase storage, OpenAI processing, Telegram Business API)
 * rather than generic boilerplate -- see docs/superpowers if this needs
 * updating alongside a real change to what data Argus touches. Placeholders
 * ([ ... ]) mark the handful of facts only Ulkan Development/Solura's legal
 * side can fill in (entity names, address, registration details) — a
 * qualified lawyer should review this before it's relied on externally. */
export default function PrivacyPage() {
  return (
    <div style={{ minHeight: "100vh", display: "flex", justifyContent: "center", padding: "48px 20px 80px" }}>
      <div style={{ width: "100%", maxWidth: 720 }}>
        <Link href="/" style={{ fontSize: 12.5, color: "var(--color-text-faint)", textDecoration: "none" }}>
          ← Argus
        </Link>
        <h1 style={{ fontFamily: "var(--font-heading)", fontSize: 26, fontWeight: 800, color: "var(--color-text)", margin: "18px 0 4px" }}>
          Политика конфиденциальности
        </h1>
        <p style={{ fontSize: 12.5, color: "var(--color-text-faint)", margin: "0 0 8px" }}>
          Последнее обновление: 9 августа 2026
        </p>
        <div className="glass-panel" style={{ padding: "28px 32px", marginTop: 20 }}>
          <p style={{ fontSize: 13.5, lineHeight: 1.7, color: "var(--color-text-soft)", margin: 0 }}>
            Argus — это внутренняя CRM-платформа с AI-слоем для отдела продаж застройщика
            «[Ulkan Development]» (проект Italiano Vero). Эта страница описывает, какие данные
            обрабатывает Argus, зачем, и кто к ним имеет доступ. Оператором персональных данных
            клиентов застройщика выступает «[Ulkan Development]»; Solura — разработчик и
            технический поставщик платформы, обрабатывающий данные по поручению оператора.
          </p>

          <Section title="1. Какие данные обрабатывает Argus">
            <p><strong>Данные сотрудников (менеджеров и руководителя отдела продаж):</strong> рабочий email
            и роль в системе — получены через вход по Google-аккаунту. Argus не хранит пароли:
            аутентификация полностью делегирована Google OAuth.</p>
            <p style={{ marginTop: 8 }}><strong>Данные клиентов застройщика:</strong> имя, номер телефона,
            история обращений и переписки (включая сообщения в Telegram, если клиент пишет застройщику
            через подключённый Telegram-аккаунт менеджера), интерес к конкретным объектам недвижимости,
            заметки менеджера по итогам звонков и встреч, статус сделки.</p>
            <p style={{ marginTop: 8 }}><strong>Технические данные:</strong> IP-адрес запроса (используется
            только для защиты от чрезмерной нагрузки на сервер, см. раздел 4), файл cookie сессии.</p>
          </Section>

          <Section title="2. Зачем эти данные обрабатываются">
            <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
              <li>Ведение сделок и истории общения с клиентом одним отделом продаж в едином месте;</li>
              <li>Формирование сводок, подсказок и черновиков ответов для менеджера (AI-функции Argus,
                см. раздел 3) — решение всегда принимает и подтверждает человек, Argus не отправляет
                клиенту ничего от AI без подтверждения менеджера;</li>
              <li>Аналитика и отчётность для руководства застройщика по ходу продаж;</li>
              <li>Формирование справок на бронирование/покупку юнита, которые направляются на согласование.</li>
            </ul>
          </Section>

          <Section title="3. AI-функции и передача данных третьим лицам">
            <p>Часть переписки и данных о клиенте (без данных других клиентов и без учётных данных
            сотрудников) передаётся в OpenAI (модель GPT-4o) для формирования сводок, черновиков ответов
            и рекомендаций менеджеру. Это единственный внешний AI-сервис, который использует Argus.</p>
            <p style={{ marginTop: 8 }}>Если застройщик подключил Telegram Business для общения с клиентами,
            сообщения передаются через инфраструктуру Telegram — как обычный канал связи, а не как
            получатель данных для собственных целей Telegram.</p>
            <p style={{ marginTop: 8 }}>Данные хранятся в базе данных Supabase (PostgreSQL) и
            обрабатываются приложением, размещённым на инфраструктуре Railway — оба выступают
            техническими субподрядчиками Solura, не имеющими самостоятельного доступа к данным для
            собственных целей.</p>
          </Section>

          <Section title="4. Как данные защищены">
            <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
              <li>Весь трафик между браузером и сервером идёт по HTTPS;</li>
              <li>Сессия хранится в cookie с флагами HttpOnly и Secure — недоступна из JavaScript
                и не передаётся по незашифрованному соединению;</li>
              <li>Данные каждого застройщика (тенанта) изолированы на уровне каждого запроса — менеджер
                одной компании не может увидеть данные другой;</li>
              <li>Доступ менеджера ограничен его собственными клиентами и сделками; полный доступ есть
                только у роли «руководитель»;</li>
              <li>Действует ограничение частоты запросов (rate limiting) на уровне API — защита от
                перегрузки и автоматизированного перебора.</li>
            </ul>
          </Section>

          <Section title="5. Сроки хранения">
            <p>Данные клиента хранятся на протяжении срока действия договора между застройщиком и Solura
            и в течение разумного срока после его окончания для целей отчётности и на случай спора, если
            иное не установлено законодательством или отдельным соглашением с застройщиком. По запросу
            застройщика данные конкретного клиента могут быть удалены раньше.</p>
          </Section>

          <Section title="6. Права субъекта данных">
            <p>Клиент застройщика вправе запросить сведения о том, какие его данные обрабатываются,
            потребовать их исправления или удаления. Такие запросы направляются напрямую застройщику
            «[Ulkan Development]» как оператору персональных данных — контакты ниже.</p>
          </Section>

          <Section title="7. Контакты">
            <p>По вопросам обработки персональных данных: <strong>[email/телефон Ulkan Development]</strong>.
            По техническим вопросам платформы Argus: <strong>[email Solura]</strong>.</p>
          </Section>
        </div>
      </div>
    </div>
  );
}
