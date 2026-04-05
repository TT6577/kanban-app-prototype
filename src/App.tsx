import { useState, useEffect } from 'react'
import { supabase } from './supabase'
import './App.css'

// Draggable items library
import { DndContext } from '@dnd-kit/core'
import type { DragEndEvent } from '@dnd-kit/core'
import { useDraggable, useDroppable, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'

// Icons library
import { AlertTriangle, Search, Tag, SquareKanban, ClipboardList, ListPlus } from 'lucide-react'

// Slide animation library
import { AnimatePresence, motion } from 'framer-motion'

/*
  Background:     #0f0f13  
  Sidebar/panels: #414152  
  Columns:        #1e1e2e 
  Cards:          #26263a  
  Accent:         #7c6af7 
  Text primary:   #e2e2e8 
  Text secondary: #8888a0 
  Border:         #2e2e42 

*/

const COLUMNS = ['To Do', 'In Progress', 'In Review', 'Done']

// Maps for conversion between variable names and page names
const STATUS_MAP: Record<string, string> = {
  'To Do': 'todo',
  'In Progress': 'in_progress',
  'In Review': 'in_review',
  'Done': 'done',
}
const STATUS_LABEL: Record<string, string> = {
  'todo': 'To Do',
  'in_progress': 'In Progress',
  'in_review': 'In Review',
  'done': 'Done',
}

// Used for sorting priorities within columns
const PRIORITY_ORDER = { high: 0, normal: 1, low: 2 }

// Set up draggable objects, lowkey don't know whats happening here tbh
function DraggableTask({ task, children }: { task: any, children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: task.id,
    data: { task }
  })

  // Let objects follow the mouse
  const style = transform ? {
    transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
  } : undefined

  return (
    <div ref={setNodeRef} style={{ ...style, minWidth: 0 }} {...listeners} {...attributes}>
      {children}
    </div>
  )
}

// Defines columns as valid drop areas
function DroppableColumn({ id, children }: { id: string, children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id })

  return (
    <div ref={setNodeRef} style={{ 
      flex: 1, 
      background: isOver ? '#2a2a4a' : '#1e1e2e', 
      borderRadius: '8px', 
      padding: '1rem', 
      transition: 'background 0.2s',
      border: '1px solid #2e2e42'
    }}>
      {children}
    </div>
  )
}

// Main app updating the kanban page
function App() {
  // Basic stuff
  const [tasks, setTasks] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)

  // Task entry form variables
  const [newTitle, setNewTitle] = useState('')
  const [newStatus, setNewStatus] = useState('todo')
  const [newDescription, setNewDescription] = useState('')
  const [newPriority, setNewPriority] = useState('low')
  const [newDate, setNewDate] = useState('')
  const [newLabel, setNewLabel] = useState('')

  // Task management variables, mostly to remember selected tasks for various actins
  const [taskToDelete, setTaskToDelete] = useState(null)
  const [selectedTask, setSelectedTask] = useState<any | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [filterLabel, setFilterLabel] = useState('')

  // For summary page
  const urgentCount = tasks.filter(t => isUrgent(t.date, t.status)).length
  const completedCount = tasks.filter(t => t.status == 'done').length

  // Setup session, find previous session if it exists, otherwise create anonymous user
  useEffect(() => {
    async function init() {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) await supabase.auth.signInAnonymously()

        const { data, error } = await supabase.from('tasks').select('*')
        if (error) console.error('tasks error:', error)
        else setTasks(data ?? [])

      } catch (err) {
        console.error('error:', err)
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [])

  // Creates task, submits data into Supabase, updates task array
  async function createTask() {
    if (!newTitle.trim()) return

    const { data: { user } } = await supabase.auth.getUser()

    const { data, error } = await supabase
      .from('tasks')
      .insert({ 
        title: newTitle, 
        status: newStatus, 
        user_id: user?.id,
        description: newDescription,
        priority: newPriority,
        date: newDate || null,
        labels: newLabel.trim() ? newLabel.trim().split(' ').filter(l => l !== '') : []
      })
      .select()
      .single()

    if (error) console.error(error)
    else {
      setTasks(prev => [...prev, data])
      clearForm()
      setShowForm(false)
    }
  }

  // Clears form
  function clearForm() {
    setNewTitle('')
    setNewDescription('')
    setNewPriority("low")
    setNewStatus("todo")
    setNewDate("")
    setNewLabel('')
  }

  // Deletes task from Supabase, updates task array
  async function deleteTask(task : any) {
    await supabase
    .from('tasks')
    .delete()
    .eq("id", task.id)
    setTasks(prev => prev.filter(t => t.id !== task.id))
    setTasks(prev => {
      const remaining = prev.filter(t => t.id !== task.id)
      if (filterLabel && !remaining.some(t => t.labels?.includes(filterLabel))) {
        setFilterLabel('')
      }
      return remaining
    })
  }

  // Updates task object when dropped, updates details page if selected task was moved
  async function onDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over) return

    const task = active.data.current?.task
    const newStatus = over.id as string

    if (task.status === newStatus) return

    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: newStatus } : t))
    if (selectedTask?.id === task.id) {
      setSelectedTask((prev: any) => ({ ...prev, status: newStatus }))
    }

    await supabase.from('tasks').update({ status: newStatus }).eq('id', task.id)
  }

  // Setup for sensors to detect when task object has been dragged far enough
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      }
    })
  )

  // Shortens title to fit within task block
  function truncate(str: string, maxLength: number): string {
    return str.length > maxLength 
      ? str.slice(0, maxLength) + "..." 
      : str;
  }

  // Returns if task is urgent
  function isUrgent(dueDate: string, status: string): boolean {
    if (!dueDate) return false
    const due = new Date(dueDate)
    const now = new Date()
    const diffMs = due.getTime() - now.getTime()
    const diffDays = diffMs / (1000 * 60 * 60 * 24)
    return diffDays <= 2 && status !== 'done'
  }

  // Returns "random" color for each label to differentiate them
  function stringToColor(str: string): string {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash)
    }
    const h = Math.abs(hash) % 360
    return `hsl(${h}, 60%, 45%)`
  }

  // Loading page
  if (loading) return <p style={{ padding: '2rem' }}>Loading...</p>

  // Main page
  return (
    <div style={{display: 'flex', width: '100%'}}>
      <div style={{ flex: 1, paddingLeft: '1rem', paddingTop: '2rem', fontFamily: 'sans-serif' }}>

        {/* Header area with title and task button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
          <h1 style={{ margin: 0, fontSize: "40px" }}>Tyler's Kanban Board</h1>
          <SquareKanban size={32}/>
          <button className='special-button' style={{ display:'flex', fontSize:"20px", borderRadius:"8px", width:'150px', alignItems:'center', gap:'5px'}} onClick={() => setShowForm(true)}>
            <ListPlus size={20}/>
            New Task
          </button>
        </div>

        {/* Shows form if new task added, can input title, status, priority, description, tags, and due date */}
        <AnimatePresence>
          {showForm && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              style={{ overflow: 'hidden', marginBottom: '1rem' }}
            >
              <div className='form-container' style={{ marginBottom: '1rem', background: '#f0f0f0', padding: '1rem', borderRadius: '8px', display: 'flex', flexDirection:"column", gap: '8px' }}>
                <div style={{ display: "flex", gap:"8px"}}>
                  <input
                    autoFocus
                    required
                    placeholder="Task title..."
                    value={newTitle}
                    onChange={e => setNewTitle(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && createTask()}
                    style={{ flex: 1, padding: '8px', borderRadius: '6px', border: '1px solid #ccc' }}
                  />
                  <select
                    name="status"
                    id="status"
                    value={newStatus}
                    onChange={e => setNewStatus(e.target.value)}
                    style={{ flex: 1/2, padding: '8px', borderRadius: '6px', border: '1px solid #ccc' }}
                  >
                    <option value="todo">To Do</option>
                    <option value="in_progress">In Progress</option>
                    <option value="in_review">In Review</option>
                    <option value="done">Done</option>
                  </select>
                  <select
                    name="priority"
                    id="priority"
                    value={newPriority}
                    onChange={e => setNewPriority(e.target.value)}
                    style={{ 
                      flex: 1/2, 
                      padding: '8px', 
                      borderRadius: '6px', 
                      border: '1px solid #ccc',
                      color: newPriority === 'low' ? 'lightgreen' : newPriority === 'high' ? 'pink' : 'gold', }}
                  >
                    <option value="low">Low</option>
                    <option value="normal">Normal</option>
                    <option value="high">High</option>
                  </select>
                </div>
                <div style={{ display: "flex", gap:"8px"}}>
                  <textarea
                    placeholder="Description (optional)..."
                    value={newDescription}
                    onChange={e => setNewDescription(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && createTask()}
                    rows={5}
                    style={{resize:'none', flex: 1, padding: '8px', borderRadius: '6px', border: '1px solid #ccc' }}
                  />
                </div>
                <div style={{ display: "flex", gap:"8px"}}>
                  <input
                    placeholder="Add a label (separated by space eg. bug design feature)..."
                    value={newLabel}
                    onChange={e => setNewLabel(e.target.value)}
                    style={{ flex: 1, padding: '8px', borderRadius: '6px', border: '1px solid #ccc' }}
                  />
                </div>
                <div style={{ display: "flex", gap:"8px"}}>
                  <label htmlFor="date" style={{alignSelf: 'center', color:"black"}}>Due Date (optional)</label>
                  <input
                    type="date"
                    value={newDate}
                    onChange={e => setNewDate(e.target.value)}
                    style={{ flex: 1/2, padding: '8px', borderRadius: '6px', border: '1px solid #ccc' }}
                  />
                  <button style={{width:'50px'}} onClick={createTask}>Save</button>
                  <button style={{width:'70px'}} onClick={() => setShowForm(false)}>Cancel</button>
                  <button style={{width:'50px'}} onClick={clearForm}>Clear</button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Creates the columns holding the tasks, the core of the kanban board */}
        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
          <div className='column' style={{ display: 'flex', flexDirection: 'row', gap: '1rem' }}>
            {COLUMNS.map(col => (
              <DroppableColumn key={col} id={STATUS_MAP[col]}>
                <h2 style={{ fontSize: '20px', color: '#e2e2e8' }}>{col}</h2>
                {/* Displays the tasks as task objects */}
                {tasks
                  .filter(t => t.title.toLowerCase().includes(searchTerm.toLowerCase()))
                  .filter(t => filterLabel === '' || t.labels?.includes(filterLabel))
                  .sort((a: any, b: any) => PRIORITY_ORDER[a.priority as keyof typeof PRIORITY_ORDER]-PRIORITY_ORDER[b.priority as keyof typeof PRIORITY_ORDER])
                  .filter(t => t.status === STATUS_MAP[col])
                  .map(task => (
                    <DraggableTask key={task.id} task={task}>
                      <div 
                        className="task-card"
                        style={{ 
                          background: task.priority === 'high' ? '#ffbfbf' : task.priority === 'normal' ? '#ffe4af' : '#bdffb6',
                          border: isUrgent(task.date, task.status) ? '2px solid red' : 'none'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <button 
                            onClick={() => setSelectedTask(task)}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left', color:'black', width: '100%', fontSize:"20px", whiteSpace: 'normal' }}
                          >
                              {truncate(task.title, 30)} {isUrgent(task.date, task.status) && <AlertTriangle size={16} color="red" />}
                          </button>
                          <button 
                            type="button" 
                            onClick={(e) => {
                              e.stopPropagation()
                              setTaskToDelete(task.id)
                            }}
                            style={{width:'20px'}}
                          >&times;
                          </button>
                        </div>

                        {/* Shows confirm and delete buttons if the x button is pressed on the task object */}
                        {taskToDelete === task.id && (
                          <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                            <button type="button" onClick={() => deleteTask(task)}>Confirm</button>
                            <button type="button" onClick={() => setTaskToDelete(null)}>Cancel</button>
                          </div>
                        )}

                        {/* Shows labels of the task, if there are any */}
                        {task.labels && task.labels.length > 0 && (
                          <div style={{ display: 'flex', gap: '4px', marginTop: '4px', flexWrap: 'wrap' }}>
                            {task.labels.map((label: string) => (
                              <span 
                                key={label} 
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setFilterLabel(filterLabel === label ? '' : label)
                                }}
                                style={{
                                  background: stringToColor(label),
                                  color: 'white',
                                  fontSize: '11px',
                                  padding: '2px 8px',
                                  borderRadius: '20px',
                                  fontWeight: 500,
                                  cursor: 'pointer'
                                }}
                              >
                                {label}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </DraggableTask>
                  ))}
              </DroppableColumn>
            ))}
          </div>

          {/* Shows the current search and selected labels, if there are any */}
          { searchTerm !== "" && (
            <div style={{ paddingTop: '1rem', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px' }}>
              <Search size={16}></Search>
              <p style={{color:'#8888a0'}}>Search: {searchTerm}</p>
            </div>
          )}

          { filterLabel !== "" && (
            <div style={{ paddingTop: '1rem', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px' }}>
              <Tag size={16} />
              <p style={{ color: '#8888a0' }}>Tags: {filterLabel}</p>
            </div>
          )}
          
        </DndContext>

      </div>


      {/* Shows the summary board or the details of tasks if user clicks on a task object */}
      <div style={{ width: '350px', flexShrink: 0, paddingLeft:'1rem' }}>
        {/* Animates entry or exit of the side panel when selected */}
        <AnimatePresence mode="wait">
          {selectedTask !== null ? (
            <motion.div
              key="task-detail"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.2 }}
              className="sidebar"
              style={{ flexDirection: 'column', padding: '1rem', paddingTop: '2rem', fontFamily: 'sans-serif', minHeight: '100vh' }}
            >
              <div style={{display:'flex', gap:'1rem'}}>
                <button 
                  type="button" 
                  onClick={() => setSelectedTask(null)}
                  style={{fontSize:'20px', width:'30px', height:'30px', flexShrink:0}}
                >&times;</button>
                <h2 style={{ wordBreak: 'break-word', textAlign:'left', overflowWrap: 'break-word' }}>{selectedTask.title}</h2>
              </div>
              <div style={{display: 'flex', gap:"1rem"}}>
                <p>Status: {STATUS_LABEL[selectedTask.status]}</p>
                <p>Priority: {selectedTask.priority.charAt(0).toUpperCase() + selectedTask.priority.slice(1)}</p>
              </div>
              <div style={{display: 'flex', gap:"1rem"}}>
                <p>Due Date: {selectedTask.date === null ? 'None' : selectedTask.date}</p>
              </div>
              <div style={{display: 'flex'}}>
                <p style={{ wordBreak: 'break-word', textAlign:'left', overflowWrap: 'break-word' }}>
                  Description: {selectedTask.description}
                </p>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="summary"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.2 }}
              className="sidebar"
              style={{ flexDirection: 'column', padding: '1rem', paddingTop: '2rem', fontFamily: 'sans-serif', minHeight: '100vh' }}
            >
              <div style={{display:'flex', gap:'1rem', paddingBottom:'20px', position:'relative'}}>
                <Search size={16} style={{ position: 'absolute', left: '10px', top: '30%', transform: 'translateY(-50%)', color: '#888' }} />
                <input 
                  type="text"
                  placeholder="Search..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)} 
                  style={{ padding: '8px', paddingLeft: '36px', width: '100%', borderRadius: '6px', border: '1px solid #ccc', boxSizing: 'border-box' }}
                />
              </div>
              <div style={{display:'flex', gap:'8px', paddingBottom:'20px'}}>
                <p style={{fontSize:'30px', color:'#ffffff'}}>Board Summary</p>
                <ClipboardList size={25}></ClipboardList>
              </div>
              <div style={{display: 'flex', gap:"1rem"}}>
                <p>Tasks: {tasks.length}</p>
              </div>
              <div style={{display: 'flex', gap:"1rem"}}>
                <p>Tasks Urgent: {urgentCount}</p>
              </div>
              <div style={{display: 'flex'}}>
                <p>Tasks Completed: {completedCount}</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

    </div>

  )
}

export default App