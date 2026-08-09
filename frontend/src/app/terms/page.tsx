import Link from "next/link";

export const metadata = { title: "Argus — Условия использования" };

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

/** Same public, static-content pattern as app/privacy/page.tsx -- see that
 * file's header comment for the placeholder/legal-review note, it applies
 * here too. */
export default function TermsPage() {
  return (
    <div style={{ minHeight: "100vh", display: "flex", justifyContent: "center", padding: "48px 20px 80px" }}>
      <div style={{ width: "100%", maxWidth: 720 }}>
        <Link href="/" style={{ fontSize: 12.5, color: "var(--color-text-faint)", textDecoration: "none" }}>
          ← Argus
        </Link>
        <h1 style={{ fontFamily: "var(--font-heading)", fontSize: 26, fontWeight: 800, color: "var(--color-text)", margin: "18px 0 4px" }}>
          Условия использования
        </h1>
        <p style={{ fontSize: 12.5, color: "var(--color-text-faint)", margin: "0 0 8px" }}>
          Последнее обновление: 9 августа 2026
        </p>
        <div className="glass-panel" style={{ padding: "28px 32px", marginTop: 20 }}>
          <p style={{ fontSize: 13.5, lineHeight: 1.7, color: "var(--color-text-soft)", margin: 0 }}>
            Настоящие условия регулируют использование Argus сотрудниками застройщика
            «[Ulkan Development]», которым предоставлен доступ к платформе. Argus предоставляется
            по отдельному договору между Solura и застройщиком; эти условия описывают правила
            использования самого продукта его пользователями (менеджерами и руководителем).
          </p>

          <Section title="1. Доступ к платформе">
            <p>Доступ предоставляется по именному приглашению через рабочий Google-аккаунт.
            Учётная запись не подлежит передаче другому человеку; за действия, совершённые под
            учётной записью пользователя, отвечает застройщик как работодатель этого пользователя.</p>
          </Section>

          <Section title="2. Допустимое использование">
            <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
              <li>Argus используется исключительно в рабочих целях — ведение клиентов, сделок и
                отчётности застройщика;</li>
              <li>Запрещается выгружать данные клиентов за пределы платформы для целей, не связанных
                с работой застройщика;</li>
              <li>Запрещаются попытки обойти разграничение доступа между ролями или тенантами.</li>
            </ul>
          </Section>

          <Section title="3. AI-функции: рекомендательный характер">
            <p>Сводки, черновики ответов, подсказки и предложения Argus Brain носят рекомендательный
            характер и формируются языковой моделью на основе имеющихся в системе данных. Ни одно
            сообщение клиенту, событие в календаре или согласование справки не выполняется автоматически
            без явного подтверждения пользователя. Ответственность за отправленное клиенту сообщение
            и принятое решение несёт подтвердивший его сотрудник.</p>
          </Section>

          <Section title="4. Доступность сервиса">
            <p>Solura прилагает разумные усилия для поддержания непрерывной работы Argus, но не
            гарантирует бесперебойную работу без сбоев — в том числе из-за зависимости отдельных
            функций от внешних сервисов (Google, OpenAI, Telegram). Плановые технические работы
            по возможности согласовываются заранее.</p>
          </Section>

          <Section title="5. Изменения условий">
            <p>Условия могут обновляться по мере развития продукта; действующая версия всегда
            доступна на этой странице. Обработка персональных данных описана отдельно в
            {" "}<Link href="/privacy" style={{ color: "var(--v-accent)" }}>Политике конфиденциальности</Link>.</p>
          </Section>

          <Section title="6. Контакты">
            <p>По вопросам использования платформы: <strong>[email Solura]</strong>.</p>
          </Section>
        </div>
      </div>
    </div>
  );
}
