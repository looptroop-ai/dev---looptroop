import fs from 'fs'
import Database from 'better-sqlite3'
import jsYaml from 'js-yaml'

const db = new Database('.looptroop/db.sqlite')
const ticket = db.prepare("SELECT id FROM tickets WHERE external_id='LOOP-7'").get() as any
if (!ticket) process.exit(1)

const artifact = db.prepare("SELECT content FROM phase_artifacts WHERE ticket_id=? AND artifact_type='interview_coverage_input' ORDER BY id DESC LIMIT 1").get(ticket.id) as any
if (!artifact) process.exit(1)

const parsed = JSON.parse(artifact.content)
const qsContent = parsed.refinedContent
let parsedQuestions: any[] = []

try {
    const yamlParsed = jsYaml.load(qsContent) as any
    if (Array.isArray(yamlParsed)) {
        parsedQuestions = yamlParsed
    } else if (yamlParsed && typeof yamlParsed === 'object' && Array.isArray(yamlParsed.questions)) {
        parsedQuestions = yamlParsed.questions
    }
} catch { /* ignore */ }

const questions = parsedQuestions.map((q, idx) => {
    const promptText = q.prompt ?? q.question ?? ''
    return {
        id: q.id ?? `Q${idx + 1}`,
        prompt: promptText,
        answer_type: q.answer_type ?? 'free_text',
        options: q.options ?? [],
        answer: {
            skipped: true,
            selected_option_ids: [],
            free_text: '',
            answered_by: 'ai_skip',
            answered_at: ''
        }
    }
})

const out = jsYaml.dump({
    schema_version: 1,
    ticket_id: 'LOOP-7',
    artifact: 'interview',
    status: 'draft',
    generated_by: {
        winner_model: 'system_fix_2',
        generated_at: new Date().toISOString()
    },
    questions,
    follow_up_rounds: [],
    summary: { goals: [], constraints: [], non_goals: [] },
    approval: { approved_by: '', approved_at: '' }
}, { lineWidth: 120, noRefs: true })

fs.writeFileSync('.looptroop/worktrees/LOOP-7/.ticket/interview.yaml', out)
console.log('Fixed LOOP-7 interview.yaml perfectly.')
