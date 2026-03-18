/**
 * SurveyOverlay — GoSelf Loyalty Widget V6
 * Inline survey with auto-advance. Rendered inside the panel content area.
 */

import React, { useState, useCallback } from 'react';
import { formatPoints } from '../utils/formatPoints.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../utils/supabase.js';

const SurveyOverlay = React.memo(function SurveyOverlay({
  survey,   // { questions: [], rewardPts: 75, headline: '...' }
  config,
  onClose,  // called after animation + refetch trigger
  onComplete, // called when done — parent triggers data.refetch("customer_session")
}) {
  const questions = survey?.questions || [];
  const rewardPts = survey?.rewardPts  || 75;

  const [step, setStep]         = useState(0); // current question index, -1 = done
  const [answers, setAnswers]   = useState({});
  const [done, setDone]         = useState(false);

  const progress = questions.length > 0
    ? Math.round((step / questions.length) * 100)
    : 0;

  const handleAnswer = useCallback((questionId, value) => {
    const newAnswers = { ...answers, [questionId]: value };
    setAnswers(newAnswers);
    // Auto-advance after 280ms
    setTimeout(async () => {
      const next = step + 1;
      if (next >= questions.length) {
        setDone(true);
        // Submit answers to unified submit-action-reward API
        try {
          const shopDomain = (typeof window !== 'undefined' && (window.Shopify?.shop || window.location?.hostname)) || '';
          const email = (typeof window !== 'undefined' && window.__goself_customer_email) || '';

          // Step 1: Persist answers (fire and forget — never block point award)
          try {
            await fetch(`${SUPABASE_URL}/functions/v1/submit-survey-response`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
              },
              body: JSON.stringify({
                email,
                shop_domain: shopDomain,
                survey_id: survey?.id || null,
                answers: newAnswers,
              }),
            });
          } catch (e) {
            console.warn('[survey] submit-survey-response failed, continuing:', e);
          }

          // Step 2: Award points
          await fetch(`${SUPABASE_URL}/functions/v1/submit-action-reward`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
              'apikey': SUPABASE_ANON_KEY,
            },
            body: JSON.stringify({
              email,
              shop_domain: shopDomain,
              rule_id: survey?.rule_id || survey?.id,
              rule_type: 'survey',
              survey_id: survey?.id || null,
              answers: newAnswers,
            }),
          });
        } catch (e) {
          console.warn('[GoSelf] survey submit failed:', e.message);
        }
        setTimeout(() => {
          onComplete && onComplete();
          onClose && onClose();
        }, 1500);
      } else {
        setStep(next);
      }
    }, 280);
  }, [step, questions.length, answers, survey, onComplete, onClose]);

  const q = questions[step];

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 10 }}
        aria-hidden="true"
      />

      {/* Sheet */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Quick survey"
        style={{
          position: 'absolute',
          bottom: 0, left: 0, right: 0,
          background: '#ffffff',
          borderRadius: '18px 18px 0 0',
          zIndex: 11,
          padding: '0 0 24px',
          animation: 'gsSheetsUp 0.28s cubic-bezier(0.175, 0.885, 0.32, 1.1) both',
        }}
      >
        {/* Progress bar */}
        <div style={{ height: 4, background: '#f3f4f6', borderRadius: '18px 18px 0 0', overflow: 'hidden' }}>
          <div
            style={{
              height: '100%',
              width: `${done ? 100 : progress}%`,
              background: config.accentColor,
              transition: 'width 0.28s ease',
            }}
          />
        </div>

        <div style={{ padding: '16px 20px 0' }}>
          {done ? (
            /* Completion state */
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <div style={{ fontSize: 48, marginBottom: 10 }}>🎉</div>
              <div style={{ fontWeight: 700, fontSize: 17, color: '#111827' }}>
                Thanks for your feedback!
              </div>
              <div style={{ fontSize: 14, color: '#16a34a', fontWeight: 600, marginTop: 8 }}>
                +{formatPoints(rewardPts, config)} added to your balance
              </div>
            </div>
          ) : q ? (
            <>
              <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 8 }}>
                Question {step + 1} of {questions.length} · Earn {formatPoints(rewardPts, config)}
              </div>
              <div style={{ fontWeight: 600, fontSize: 15, color: '#111827', marginBottom: 16 }}>
                {q.text}
              </div>

              {q.type === 'rating' && (
                <RatingQuestion
                  question={q}
                  onAnswer={handleAnswer}
                  accentColor={config.accentColor}
                />
              )}
              {q.type === 'single' && (
                <SingleChoiceQuestion
                  question={q}
                  onAnswer={handleAnswer}
                  accentColor={config.accentColor}
                />
              )}
            </>
          ) : null}
        </div>
      </div>
    </>
  );
});

/* ── Rating question (emoji row) ─────────────────────────────────────────── */
function RatingQuestion({ question, onAnswer, accentColor }) {
  const [selected, setSelected] = useState(null);
  const max = question.maxRating || 5;
  const EMOJIS = ['😞', '😐', '🙂', '😊', '🤩'];

  return (
    <div style={{ display: 'flex', justifyContent: 'space-around', marginBottom: 16 }}>
      {Array.from({ length: max }, (_, i) => {
        const val = i + 1;
        const isSelected = selected === val;
        return (
          <button
            key={val}
            onClick={() => { setSelected(val); onAnswer(question.id, val); }}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 4,
              background: isSelected ? `${accentColor}18` : 'transparent',
              border: isSelected ? `2px solid ${accentColor}` : '2px solid transparent',
              borderRadius: 10,
              padding: '8px 10px',
              cursor: 'pointer',
              fontSize: 26,
            }}
          >
            {EMOJIS[i] || val}
            <span style={{ fontSize: 10, color: '#6b7280' }}>{val}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ── Single choice question (option list) ────────────────────────────────── */
function SingleChoiceQuestion({ question, onAnswer, accentColor }) {
  const [selected, setSelected] = useState(null);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
      {(question.options || []).map(opt => {
        const isSelected = selected === opt;
        return (
          <button
            key={opt}
            onClick={() => { setSelected(opt); onAnswer(question.id, opt); }}
            style={{
              textAlign: 'left',
              padding: '11px 14px',
              border: isSelected ? `2px solid ${accentColor}` : '2px solid #e5e7eb',
              borderRadius: 10,
              background: isSelected ? `${accentColor}10` : '#ffffff',
              color: isSelected ? accentColor : '#374151',
              fontWeight: isSelected ? 600 : 400,
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

export default SurveyOverlay;
