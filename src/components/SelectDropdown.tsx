import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { Check, ChevronDown } from 'lucide-react';

export interface DropdownOption<T extends string = string> {
  value: T;
  label: string;
  description?: string;
  icon?: ReactNode;
  tone?: 'default' | 'action' | 'success' | 'warning' | 'destructive';
}

interface SelectDropdownProps<T extends string = string> {
  id?: string;
  value: T;
  options: DropdownOption<T>[];
  onChange: (nextValue: T) => void;
  ariaLabel?: string;
  size?: 'default' | 'compact';
  align?: 'left' | 'right';
  fullWidth?: boolean;
}

export function SelectDropdown<T extends string = string>({
  id,
  value,
  options,
  onChange,
  ariaLabel,
  size = 'default',
  align = 'left',
  fullWidth = true,
}: SelectDropdownProps<T>) {
  const generatedId = useId();
  const triggerId = id ?? generatedId;
  const listboxId = `${triggerId}-listbox`;

  const [open, setOpen] = useState(false);
  const [dropUp, setDropUp] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState<number>(() =>
    Math.max(
      0,
      options.findIndex((o) => o.value === value)
    )
  );

  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selectedOption =
    options.find((opt) => opt.value === value) ?? options[0];

  useEffect(() => {
    const idx = options.findIndex((o) => o.value === value);
    if (idx >= 0) {
      setHighlightedIndex(idx);
    }
  }, [value, options]);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const estimatedHeight = Math.min(260, options.length * 42 + 14);
    const container = triggerRef.current.closest(
      '.modal-panel, .popup-scroll-wrap'
    );
    const boundsBottom = container
      ? container.getBoundingClientRect().bottom
      : window.innerHeight;
    const boundsTop = container
      ? container.getBoundingClientRect().top
      : 0;
    const spaceBelow = boundsBottom - rect.bottom;
    const spaceAbove = rect.top - boundsTop;
    setDropUp(spaceBelow < estimatedHeight && spaceAbove > spaceBelow);
  }, [open, options.length]);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (
        rootRef.current &&
        !rootRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };

    const handleKeyDownCapture = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDownCapture, true);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDownCapture, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !listRef.current) return;
    const activeEl = listRef.current.querySelector<HTMLElement>(
      `[data-option-index="${highlightedIndex}"]`
    );
    activeEl?.scrollIntoView({ block: 'nearest' });
  }, [open, highlightedIndex]);

  const commitSelection = (index: number) => {
    const chosen = options[index];
    if (!chosen) return;
    onChange(chosen.value);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const handleTriggerKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>
  ) => {
    if (options.length === 0) return;

    if (!open) {
      if (
        event.key === 'ArrowDown' ||
        event.key === 'ArrowUp' ||
        event.key === 'Enter' ||
        event.key === ' '
      ) {
        event.preventDefault();
        const currentIdx = Math.max(
          0,
          options.findIndex((o) => o.value === value)
        );
        setHighlightedIndex(currentIdx);
        setOpen(true);
      }
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlightedIndex((prev) => (prev + 1) % options.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlightedIndex(
        (prev) => (prev - 1 + options.length) % options.length
      );
    } else if (event.key === 'Home') {
      event.preventDefault();
      setHighlightedIndex(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setHighlightedIndex(options.length - 1);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      commitSelection(highlightedIndex);
    } else if (event.key === 'Tab') {
      setOpen(false);
    }
  };

  return (
    <div
      ref={rootRef}
      className={`custom-dropdown ${fullWidth ? 'is-full' : 'is-auto'} ${
        open ? 'is-open' : ''
      }`}
    >
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        className={`dropdown-trigger ${
          size === 'compact' ? 'dropdown-trigger--compact' : ''
        }`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-label={ariaLabel}
        onClick={() => setOpen((prev) => !prev)}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className="dropdown-trigger-content">
          {selectedOption?.icon ? (
            <span
              className={`dropdown-option-icon ${
                selectedOption.tone
                  ? `dropdown-tone--${selectedOption.tone}`
                  : ''
              }`}
              aria-hidden="true"
            >
              {selectedOption.icon}
            </span>
          ) : null}
          <span className="dropdown-trigger-label">
            {selectedOption?.label ?? 'Selecionar'}
          </span>
        </span>

        <ChevronDown
          size={15}
          className={`dropdown-chevron ${open ? 'is-rotated' : ''}`}
          aria-hidden="true"
        />
      </button>

      {open ? (
        <div
          ref={listRef}
          id={listboxId}
          role="listbox"
          aria-label={ariaLabel}
          className={`dropdown-menu ${dropUp ? 'is-dropup' : ''} ${
            align === 'right' ? 'is-align-right' : ''
          }`}
        >
          {options.map((opt, index) => {
            const isSelected = opt.value === value;
            const isHighlighted = index === highlightedIndex;
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                data-option-index={index}
                className={`dropdown-option ${isSelected ? 'is-selected' : ''} ${
                  isHighlighted ? 'is-highlighted' : ''
                }`}
                onMouseEnter={() => setHighlightedIndex(index)}
                onClick={() => commitSelection(index)}
              >
                <span className="dropdown-option-main">
                  {opt.icon ? (
                    <span
                      className={`dropdown-option-icon ${
                        opt.tone ? `dropdown-tone--${opt.tone}` : ''
                      }`}
                      aria-hidden="true"
                    >
                      {opt.icon}
                    </span>
                  ) : null}
                  <span className="dropdown-option-texts">
                    <span className="dropdown-option-label">{opt.label}</span>
                    {opt.description ? (
                      <span className="dropdown-option-desc">
                        {opt.description}
                      </span>
                    ) : null}
                  </span>
                </span>

                {isSelected ? (
                  <Check
                    size={15}
                    className="dropdown-check"
                    aria-hidden="true"
                  />
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
