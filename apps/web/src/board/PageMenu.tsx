import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Pencil, Plus, Trash2 } from 'lucide-react'
import { useBoardValue, useEditor } from './engine/react.ts'

// Page navigation, top-left. Anyone who can see it can move between pages; only
// `canEdit` can add, rename or delete them.
export function PageMenu({ canEdit }: { canEdit: boolean }) {
  const editor = useEditor()
  const pages = useBoardValue(editor, () => editor.getPages())
  const currentId = useBoardValue(editor, () => editor.getCurrentPageId())
  const [open, setOpen] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('pointerdown', close, true)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('pointerdown', close, true)
      window.removeEventListener('keydown', esc)
    }
  }, [open])

  const current = pages.find((p) => p.id === currentId)

  return (
    <div className="page-menu" ref={root}>
      <button className="dock-btn page-menu__trigger" aria-expanded={open} aria-label="Pages" onClick={() => setOpen((v) => !v)}>
        <span className="page-menu__name">{current?.name}</span>
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="page-menu__panel" role="menu">
          {pages.map((page) => (
            <div key={page.id} className="page-menu__row">
              {renaming === page.id ? (
                <input
                  className="page-menu__input"
                  autoFocus
                  defaultValue={page.name}
                  maxLength={80}
                  onKeyDown={(e) => {
                    e.stopPropagation()
                    if (e.key === 'Enter') e.currentTarget.blur()
                    if (e.key === 'Escape') setRenaming(null)
                  }}
                  onBlur={(e) => {
                    const name = e.target.value.trim()
                    if (name && renaming === page.id) editor.doc.renamePage(page.id, name)
                    setRenaming(null)
                  }}
                />
              ) : (
                <button
                  role="menuitem"
                  className="page-menu__item"
                  onClick={() => {
                    editor.setCurrentPage(page.id)
                    setOpen(false)
                  }}
                >
                  <span className="page-menu__check">{page.id === currentId && <Check size={14} />}</span>
                  <span className="page-menu__name">{page.name}</span>
                </button>
              )}
              {canEdit && renaming !== page.id && (
                <>
                  <button className="page-menu__action" aria-label={`Rename ${page.name}`} title="Rename" onClick={() => setRenaming(page.id)}>
                    <Pencil size={13} />
                  </button>
                  {pages.length > 1 && (
                    <button
                      className="page-menu__action"
                      aria-label={`Delete ${page.name}`}
                      title="Delete page (undo brings it back)"
                      onClick={() => {
                        editor.doc.mark()
                        editor.doc.deletePage(page.id)
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </>
              )}
            </div>
          ))}
          {canEdit && (
            <button
              className="page-menu__item page-menu__add"
              onClick={() => {
                editor.addPage()
                setOpen(false)
              }}
            >
              <Plus size={14} />
              New page
            </button>
          )}
        </div>
      )}
    </div>
  )
}
