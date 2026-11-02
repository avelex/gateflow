// The Gateflow design system, taken from design/Gateflow Console.html (DeflowDesignSystem_0655fb bundle).
// Component bodies are verbatim; only the bundle's global wrappers were removed. Do not restyle here.
import React from "react";
// ponytail: Icon takes any Lucide name at runtime, so the whole icon set ships (~80 kB gzip); map only used icons if size matters.
import { icons } from "lucide";

const __ds_scope = {};

// components/core/Icon.jsx
(() => {
const pascal = n => n.replace(/(^|-)([a-z0-9])/g, (_, a, b) => b.toUpperCase());
function Icon({
  name,
  size = 16,
  strokeWidth = 1.5,
  color = 'currentColor',
  style,
  ...rest
}) {
  const L = { icons };
  let node = L && L.icons ? L.icons[pascal(name)] : null;
  if (node && node[0] === 'svg') node = node[2];
  const kids = (node || []).map(([t, a], i) => React.createElement(t, {
    ...a,
    key: i
  }));
  return React.createElement('svg', {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: color,
    strokeWidth,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
    style: {
      flex: 'none',
      display: 'inline-block',
      verticalAlign: 'middle',
      ...style
    },
    ...rest
  }, kids);
}
Object.assign(__ds_scope, { Icon });
})();

// components/core/Button.jsx
(() => {
const H = {
  sm: 'var(--control-h-sm)',
  md: 'var(--control-h-md)',
  lg: 'var(--control-h-lg)'
};
const P = {
  sm: '0 10px',
  md: '0 14px',
  lg: '0 20px'
};
const V = {
  primary: {
    background: 'var(--accent)',
    color: 'var(--text-inverse)',
    border: '1px solid var(--accent)'
  },
  secondary: {
    background: 'var(--surface-card)',
    color: 'var(--text-1)',
    border: '1px solid var(--border-2)'
  },
  ink: {
    background: 'var(--ink-950)',
    color: 'var(--text-inverse)',
    border: '1px solid var(--ink-950)'
  },
  ghost: {
    background: 'transparent',
    color: 'var(--text-1)',
    border: '1px solid transparent'
  },
  danger: {
    background: 'var(--surface-card)',
    color: 'var(--red-700)',
    border: '1px solid var(--red-600)'
  }
};
const HOV = {
  primary: {
    background: 'var(--accent-hover)',
    borderColor: 'var(--accent-hover)'
  },
  secondary: {
    background: 'var(--surface-hover)',
    borderColor: 'var(--ink-400)'
  },
  ink: {
    background: 'var(--ink-800)'
  },
  ghost: {
    background: 'var(--surface-hover)'
  },
  danger: {
    background: 'var(--red-50)'
  }
};
function Button({
  variant = 'primary',
  size = 'md',
  icon,
  iconRight,
  disabled,
  fullWidth,
  children,
  onClick,
  type = 'button',
  style
}) {
  const [h, setH] = React.useState(false);
  const [p, setP] = React.useState(false);
  const s = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: H[size],
    padding: P[size],
    fontFamily: 'var(--font-sans)',
    fontSize: size === 'sm' ? 13 : size === 'lg' ? 15 : 14,
    fontWeight: 600,
    letterSpacing: '-0.005em',
    borderRadius: 'var(--radius-2)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    whiteSpace: 'nowrap',
    transition: 'background var(--dur-fast) var(--ease-standard),border-color var(--dur-fast)',
    width: fullWidth ? '100%' : undefined,
    ...V[variant],
    ...(h && !disabled ? HOV[variant] : {}),
    ...(p && !disabled ? {
      transform: 'translateY(1px)'
    } : {}),
    ...(disabled ? {
      opacity: .45
    } : {}),
    ...style
  };
  return /*#__PURE__*/React.createElement("button", {
    type: type,
    disabled: disabled,
    onClick: onClick,
    style: s,
    onMouseEnter: () => setH(true),
    onMouseLeave: () => {
      setH(false);
      setP(false);
    },
    onMouseDown: () => setP(true),
    onMouseUp: () => setP(false)
  }, icon && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon,
    size: size === 'lg' ? 18 : 16
  }), children, iconRight && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: iconRight,
    size: size === 'lg' ? 18 : 16
  }));
}
Object.assign(__ds_scope, { Button });
})();

// components/core/IconButton.jsx
(() => {
function IconButton({
  icon,
  label,
  size = 'md',
  variant = 'ghost',
  onClick,
  disabled
}) {
  const [h, setH] = React.useState(false);
  const d = size === 'sm' ? 28 : size === 'lg' ? 44 : 36;
  const base = variant === 'secondary' ? {
    background: h ? 'var(--surface-hover)' : 'var(--surface-card)',
    border: '1px solid var(--border-2)'
  } : {
    background: h ? 'var(--surface-hover)' : 'transparent',
    border: '1px solid transparent'
  };
  return /*#__PURE__*/React.createElement("button", {
    "aria-label": label,
    title: label,
    disabled: disabled,
    onClick: onClick,
    onMouseEnter: () => setH(true),
    onMouseLeave: () => setH(false),
    style: {
      width: d,
      height: d,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 'var(--radius-2)',
      color: 'var(--text-2)',
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? .45 : 1,
      padding: 0,
      transition: 'background var(--dur-fast)',
      ...base
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon,
    size: size === 'lg' ? 20 : 16
  }));
}
Object.assign(__ds_scope, { IconButton });
})();

// components/display/Badge.jsx
(() => {
const T = {
  neutral: ['var(--ink-800)', 'var(--ink-150)'],
  accent: ['var(--blue-700)', 'var(--blue-50)'],
  success: ['var(--green-700)', 'var(--green-50)'],
  warning: ['var(--amber-700)', 'var(--amber-50)'],
  danger: ['var(--red-700)', 'var(--red-50)'],
  ink: ['#fff', 'var(--ink-950)']
};
function Badge({
  tone = 'neutral',
  children,
  dot
}) {
  const [fg, bg] = T[tone];
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      height: 20,
      padding: '0 7px',
      borderRadius: 'var(--radius-1)',
      background: bg,
      color: fg,
      fontSize: 12,
      fontWeight: 600,
      lineHeight: 1,
      whiteSpace: 'nowrap',
      flex: 'none'
    }
  }, dot && /*#__PURE__*/React.createElement("span", {
    style: {
      width: 6,
      height: 6,
      background: 'currentColor'
    }
  }), children);
}
Object.assign(__ds_scope, { Badge });
})();

// components/display/Card.jsx
(() => {
function Card({
  title,
  meta,
  actions,
  children,
  padding = 20,
  footer,
  style
}) {
  return /*#__PURE__*/React.createElement("section", {
    style: {
      background: 'var(--surface-card)',
      border: '1px solid var(--border-1)',
      borderRadius: 'var(--radius-2)',
      ...style
    }
  }, (title || actions) && /*#__PURE__*/React.createElement("header", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      flexWrap: 'wrap',
      gap: 12,
      padding: '14px 20px',
      borderBottom: '1px solid var(--border-1)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'baseline',
      flexWrap: 'wrap',
      gap: '2px 10px',
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("h3", {
    style: {
      margin: 0,
      fontSize: 15,
      fontWeight: 600,
      letterSpacing: '-0.005em',
      whiteSpace: 'nowrap'
    }
  }, title), meta && /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 12,
      color: 'var(--text-3)',
      whiteSpace: 'nowrap'
    }
  }, meta)), actions && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8
    }
  }, actions)), /*#__PURE__*/React.createElement("div", {
    style: {
      padding
    }
  }, children), footer && /*#__PURE__*/React.createElement("footer", {
    style: {
      padding: '12px 20px',
      borderTop: '1px solid var(--border-1)',
      background: 'var(--ink-50)',
      fontSize: 13,
      color: 'var(--text-2)'
    }
  }, footer));
}
Object.assign(__ds_scope, { Card });
})();

// components/display/Hash.jsx
(() => {
function Hash({
  value = '',
  head = 6,
  tail = 4,
  copy = true,
  muted
}) {
  const [ok, setOk] = React.useState(false);
  const short = value.length > head + tail + 2 ? value.slice(0, head) + '…' + value.slice(-tail) : value;
  const c = () => {
    try {
      navigator.clipboard.writeText(value);
    } catch (e) {}
    setOk(true);
    setTimeout(() => setOk(false), 1200);
  };
  return /*#__PURE__*/React.createElement("span", {
    title: value,
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      whiteSpace: 'nowrap',
      fontFamily: 'var(--font-mono)',
      fontSize: 13,
      color: muted ? 'var(--text-3)' : 'var(--text-1)'
    }
  }, short, copy && /*#__PURE__*/React.createElement("span", {
    onClick: c,
    style: {
      cursor: 'pointer',
      color: ok ? 'var(--success)' : 'var(--text-3)',
      display: 'inline-flex'
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: ok ? 'check' : 'copy',
    size: 13
  })));
}
Object.assign(__ds_scope, { Hash });
})();

// components/display/Stat.jsx
(() => {
function Stat({
  label,
  value,
  unit,
  delta,
  sub
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 4
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      fontWeight: 600,
      color: 'var(--text-3)'
    }
  }, label), /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'flex',
      alignItems: 'baseline',
      gap: 6,
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 28,
      lineHeight: '32px',
      fontWeight: 600,
      letterSpacing: '-0.02em',
      fontVariantNumeric: 'tabular-nums',
      whiteSpace: 'nowrap'
    }
  }, value), unit && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 14,
      color: 'var(--text-3)',
      fontWeight: 500
    }
  }, unit)), (delta || sub) && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: 'var(--text-3)'
    }
  }, delta && /*#__PURE__*/React.createElement("b", {
    style: {
      fontWeight: 600,
      color: delta.startsWith('-') ? 'var(--green-700)' : 'var(--text-2)'
    }
  }, delta, " "), sub));
}
Object.assign(__ds_scope, { Stat });
})();

// components/display/StatusBadge.jsx
(() => {
const M = {
  held: ['Held', 'held'],
  checking: ['Checking', 'checking'],
  review: ['Needs review', 'review'],
  credited: ['Credited', 'approved'],
  frozen: ['Frozen', 'frozen'],
  returned: ['Returned', 'held'],
  settled: ['Settled', 'approved']
};
function StatusBadge({
  status = 'held',
  label
}) {
  const [l, k] = M[status] || M.held;
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      height: 22,
      padding: '0 8px',
      borderRadius: 'var(--radius-1)',
      background: 'var(--status-' + k + '-bg)',
      color: 'var(--status-' + k + '-fg)',
      fontSize: 12,
      fontWeight: 600,
      whiteSpace: 'nowrap'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 6,
      height: 6,
      background: 'currentColor',
      borderRadius: status === 'checking' ? '50%' : 0
    }
  }), label || l);
}
Object.assign(__ds_scope, { StatusBadge });
})();

// components/display/Tag.jsx
(() => {
function Tag({
  children,
  onRemove,
  icon
}) {
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      height: 24,
      whiteSpace: 'nowrap',
      flex: 'none',
      padding: '0 8px',
      border: '1px solid var(--border-2)',
      borderRadius: 'var(--radius-2)',
      background: 'var(--surface-card)',
      fontSize: 12,
      fontWeight: 500,
      color: 'var(--text-2)'
    }
  }, icon && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon,
    size: 13
  }), children, onRemove && /*#__PURE__*/React.createElement("span", {
    onClick: onRemove,
    style: {
      cursor: 'pointer',
      display: 'inline-flex',
      color: 'var(--text-3)'
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "x",
    size: 12
  })));
}
Object.assign(__ds_scope, { Tag });
})();

// components/feedback/Dialog.jsx
(() => {
function Dialog({
  open = true,
  title,
  children,
  footer,
  onClose,
  width = 480,
  inline
}) {
  if (!open) return null;
  const box = /*#__PURE__*/React.createElement("div", {
    role: "dialog",
    style: {
      width,
      maxWidth: '100%',
      background: 'var(--surface-card)',
      borderRadius: 'var(--radius-3)',
      boxShadow: 'var(--shadow-pop)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '16px 20px 0'
    }
  }, /*#__PURE__*/React.createElement("h3", {
    style: {
      margin: 0,
      fontSize: 17,
      fontWeight: 600,
      letterSpacing: '-0.01em'
    }
  }, title), onClose && /*#__PURE__*/React.createElement(__ds_scope.IconButton, {
    icon: "x",
    label: "Close",
    size: "sm",
    onClick: onClose
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '12px 20px 20px',
      fontSize: 14,
      color: 'var(--text-2)'
    }
  }, children), footer && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'flex-end',
      gap: 8,
      padding: '12px 20px',
      borderTop: '1px solid var(--border-1)'
    }
  }, footer));
  if (inline) return box;
  return /*#__PURE__*/React.createElement("div", {
    onClick: e => {
      if (e.target === e.currentTarget && onClose) onClose();
    },
    style: {
      position: 'fixed',
      inset: 0,
      background: 'rgba(10,12,16,.48)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
      zIndex: 100
    }
  }, box);
}
Object.assign(__ds_scope, { Dialog });
})();

// components/feedback/Toast.jsx
(() => {
const I = {
  info: ['info', 'var(--blue-300)'],
  success: ['circle-check', '#6FCF97'],
  warning: ['triangle-alert', '#F2C94C'],
  danger: ['octagon-alert', '#F28B82']
};
function Toast({
  tone = 'info',
  title,
  children,
  action
}) {
  const [ic, col] = I[tone];
  return /*#__PURE__*/React.createElement("div", {
    role: "status",
    style: {
      display: 'flex',
      gap: 12,
      alignItems: 'flex-start',
      width: 360,
      maxWidth: '100%',
      padding: '12px 14px',
      background: 'var(--ink-950)',
      color: '#fff',
      borderRadius: 'var(--radius-2)',
      boxShadow: 'var(--shadow-pop)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: col,
      marginTop: 2
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: ic,
    size: 16
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14,
      fontWeight: 600
    }
  }, title), children && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: 'var(--ink-300)',
      marginTop: 2
    }
  }, children)), action);
}
Object.assign(__ds_scope, { Toast });
})();

// components/feedback/Tooltip.jsx
(() => {
function Tooltip({
  content,
  children,
  placement = 'top'
}) {
  const [o, setO] = React.useState(false);
  const pos = placement === 'bottom' ? {
    top: '100%',
    marginTop: 6
  } : {
    bottom: '100%',
    marginBottom: 6
  };
  return /*#__PURE__*/React.createElement("span", {
    onMouseEnter: () => setO(true),
    onMouseLeave: () => setO(false),
    style: {
      position: 'relative',
      display: 'inline-flex'
    }
  }, children, o && /*#__PURE__*/React.createElement("span", {
    role: "tooltip",
    style: {
      position: 'absolute',
      left: '50%',
      transform: 'translateX(-50%)',
      ...pos,
      whiteSpace: 'nowrap',
      background: 'var(--ink-950)',
      color: '#fff',
      fontSize: 12,
      lineHeight: '16px',
      padding: '5px 8px',
      borderRadius: 'var(--radius-1)',
      zIndex: 50,
      pointerEvents: 'none'
    }
  }, content));
}
Object.assign(__ds_scope, { Tooltip });
})();

// components/flow/FlowSteps.jsx
(() => {
function FlowSteps({
  steps = [],
  current = -1,
  compact
}) {
  return /*#__PURE__*/React.createElement("ol", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(' + steps.length + ',minmax(0,1fr))',
      gap: 0,
      margin: 0,
      padding: 0,
      listStyle: 'none'
    }
  }, steps.map((s, i) => {
    const done = i < current,
      on = i === current;
    return /*#__PURE__*/React.createElement("li", {
      key: i,
      style: {
        borderTop: '2px solid ' + (done || on ? 'var(--accent)' : 'var(--border-1)'),
        paddingTop: 10,
        paddingRight: 12
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        color: on ? 'var(--accent)' : 'var(--text-3)',
        marginBottom: 4
      }
    }, String(i + 1).padStart(2, '0')), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: compact ? 13 : 14,
        fontWeight: 600,
        color: done || on ? 'var(--text-1)' : 'var(--text-2)'
      }
    }, s.title), s.text && !compact && /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 12,
        lineHeight: '16px',
        color: 'var(--text-3)',
        marginTop: 2
      }
    }, s.text));
  }));
}
Object.assign(__ds_scope, { FlowSteps });
})();

// components/forms/Checkbox.jsx
(() => {
function Checkbox({
  label,
  description,
  checked,
  defaultChecked,
  onChange,
  disabled
}) {
  const [c, setC] = React.useState(!!defaultChecked);
  const on = checked !== undefined ? checked : c;
  const t = () => {
    if (disabled) return;
    setC(!on);
    onChange && onChange(!on);
  };
  return /*#__PURE__*/React.createElement("label", {
    onClick: t,
    style: {
      display: 'flex',
      gap: 10,
      alignItems: 'flex-start',
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? .5 : 1
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 16,
      height: 16,
      marginTop: 3,
      flex: 'none',
      borderRadius: 'var(--radius-1)',
      border: '1px solid ' + (on ? 'var(--accent)' : 'var(--ink-400)'),
      background: on ? 'var(--accent)' : 'var(--surface-card)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: '#fff'
    }
  }, on && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "check",
    size: 12,
    strokeWidth: 2.5
  })), /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'block',
      fontSize: 14,
      fontWeight: 500
    }
  }, label), description && /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'block',
      fontSize: 13,
      color: 'var(--text-3)'
    }
  }, description)));
}
Object.assign(__ds_scope, { Checkbox });
})();

// components/forms/Input.jsx
(() => {
const lab = {
  display: 'block',
  fontSize: 'var(--fs-small)',
  fontWeight: 600,
  color: 'var(--text-1)',
  marginBottom: 6
};
const hintS = e => ({
  fontSize: 'var(--fs-caption)',
  color: e ? 'var(--red-700)' : 'var(--text-3)',
  marginTop: 6
});
function Input({
  label,
  hint,
  error,
  placeholder,
  value,
  defaultValue,
  onChange,
  type = 'text',
  mono,
  prefix,
  suffix,
  disabled,
  style
}) {
  const [f, setF] = React.useState(false);
  const bc = error ? 'var(--red-600)' : f ? 'var(--border-focus)' : 'var(--border-2)';
  return /*#__PURE__*/React.createElement("label", {
    style: {
      display: 'block',
      ...style
    }
  }, label && /*#__PURE__*/React.createElement("span", {
    style: lab
  }, label), /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'flex',
      alignItems: 'center',
      height: 'var(--control-h-md)',
      background: disabled ? 'var(--surface-sunken)' : 'var(--surface-card)',
      border: '1px solid ' + bc,
      borderRadius: 'var(--radius-2)',
      boxShadow: f ? '0 0 0 3px var(--blue-100)' : 'none',
      transition: 'box-shadow var(--dur-fast),border-color var(--dur-fast)'
    }
  }, prefix && /*#__PURE__*/React.createElement("span", {
    style: {
      paddingLeft: 10,
      color: 'var(--text-3)',
      fontSize: 13
    }
  }, prefix), /*#__PURE__*/React.createElement("input", {
    type: type,
    placeholder: placeholder,
    value: value,
    defaultValue: defaultValue,
    onChange: onChange,
    disabled: disabled,
    onFocus: () => setF(true),
    onBlur: () => setF(false),
    style: {
      flex: 1,
      minWidth: 0,
      height: '100%',
      border: 0,
      outline: 0,
      background: 'transparent',
      padding: '0 10px',
      fontFamily: mono ? 'var(--font-mono)' : 'var(--font-sans)',
      fontSize: mono ? 13 : 14,
      color: 'var(--text-1)'
    }
  }), suffix && /*#__PURE__*/React.createElement("span", {
    style: {
      paddingRight: 10,
      color: 'var(--text-3)',
      fontSize: 13
    }
  }, suffix)), (hint || error) && /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'block',
      ...hintS(!!error)
    }
  }, error || hint));
}
Object.assign(__ds_scope, { Input });
})();

// components/forms/Radio.jsx
(() => {
function Radio({
  name,
  options = [],
  value,
  defaultValue,
  onChange,
  direction = 'column'
}) {
  const [v, setV] = React.useState(defaultValue);
  const cur = value !== undefined ? value : v;
  return /*#__PURE__*/React.createElement("div", {
    role: "radiogroup",
    style: {
      display: 'flex',
      flexDirection: direction,
      gap: direction === 'row' ? 20 : 10
    }
  }, options.map(o => {
    const val = o.value || o;
    const on = cur === val;
    return /*#__PURE__*/React.createElement("label", {
      key: val,
      onClick: () => {
        setV(val);
        onChange && onChange(val);
      },
      style: {
        display: 'flex',
        gap: 10,
        alignItems: 'flex-start',
        cursor: 'pointer'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        width: 16,
        height: 16,
        marginTop: 3,
        flex: 'none',
        borderRadius: '50%',
        border: '1px solid ' + (on ? 'var(--accent)' : 'var(--ink-400)'),
        background: 'var(--surface-card)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }
    }, on && /*#__PURE__*/React.createElement("span", {
      style: {
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: 'var(--accent)'
      }
    })), /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("span", {
      style: {
        display: 'block',
        fontSize: 14,
        fontWeight: 500
      }
    }, o.label || o), o.description && /*#__PURE__*/React.createElement("span", {
      style: {
        display: 'block',
        fontSize: 13,
        color: 'var(--text-3)'
      }
    }, o.description)));
  }));
}
Object.assign(__ds_scope, { Radio });
})();

// components/forms/Select.jsx
(() => {
const lab = {
  display: 'block',
  fontSize: 'var(--fs-small)',
  fontWeight: 600,
  color: 'var(--text-1)',
  marginBottom: 6
};
const hintS = e => ({
  fontSize: 'var(--fs-caption)',
  color: e ? 'var(--red-700)' : 'var(--text-3)',
  marginTop: 6
});
function Select({
  label,
  hint,
  options = [],
  value,
  defaultValue,
  onChange,
  disabled,
  style
}) {
  return /*#__PURE__*/React.createElement("label", {
    style: {
      display: 'block',
      ...style
    }
  }, label && /*#__PURE__*/React.createElement("span", {
    style: lab
  }, label), /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'relative',
      display: 'flex'
    }
  }, /*#__PURE__*/React.createElement("select", {
    value: value,
    defaultValue: defaultValue,
    onChange: onChange,
    disabled: disabled,
    style: {
      appearance: 'none',
      width: '100%',
      height: 'var(--control-h-md)',
      border: '1px solid var(--border-2)',
      borderRadius: 'var(--radius-2)',
      background: disabled ? 'var(--surface-sunken)' : 'var(--surface-card)',
      padding: '0 32px 0 10px',
      fontFamily: 'var(--font-sans)',
      fontSize: 14,
      color: 'var(--text-1)'
    }
  }, options.map(o => typeof o === 'string' ? /*#__PURE__*/React.createElement("option", {
    key: o
  }, o) : /*#__PURE__*/React.createElement("option", {
    key: o.value,
    value: o.value
  }, o.label))), /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      right: 10,
      top: '50%',
      transform: 'translateY(-50%)',
      pointerEvents: 'none',
      color: 'var(--text-3)'
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "chevron-down",
    size: 16
  }))), hint && /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'block',
      ...hintS(false)
    }
  }, hint));
}
Object.assign(__ds_scope, { Select });
})();

// components/forms/Switch.jsx
(() => {
function Switch({
  label,
  checked,
  defaultChecked,
  onChange,
  disabled
}) {
  const [c, setC] = React.useState(!!defaultChecked);
  const on = checked !== undefined ? checked : c;
  return /*#__PURE__*/React.createElement("label", {
    onClick: () => {
      if (disabled) return;
      setC(!on);
      onChange && onChange(!on);
    },
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 10,
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? .5 : 1
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 32,
      height: 18,
      borderRadius: 'var(--radius-pill)',
      background: on ? 'var(--accent)' : 'var(--ink-300)',
      position: 'relative',
      transition: 'background var(--dur-base) var(--ease-standard)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      top: 2,
      left: on ? 16 : 2,
      width: 14,
      height: 14,
      borderRadius: '50%',
      background: '#fff',
      boxShadow: '0 1px 2px rgba(0,0,0,.2)',
      transition: 'left var(--dur-base) var(--ease-standard)'
    }
  })), label && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 14,
      fontWeight: 500
    }
  }, label));
}
Object.assign(__ds_scope, { Switch });
})();

// components/navigation/Tabs.jsx
(() => {
function Tabs({
  tabs = [],
  value,
  defaultValue,
  onChange
}) {
  const [v, setV] = React.useState(defaultValue || tabs[0] && (tabs[0].value || tabs[0]));
  const cur = value !== undefined ? value : v;
  return /*#__PURE__*/React.createElement("div", {
    role: "tablist",
    style: {
      display: 'flex',
      gap: 24,
      borderBottom: '1px solid var(--border-1)'
    }
  }, tabs.map(t => {
    const val = t.value || t;
    const on = val === cur;
    return /*#__PURE__*/React.createElement("button", {
      key: val,
      role: "tab",
      "aria-selected": on,
      onClick: () => {
        setV(val);
        onChange && onChange(val);
      },
      style: {
        background: 'none',
        border: 0,
        padding: '10px 0',
        marginBottom: -1,
        borderBottom: '2px solid ' + (on ? 'var(--ink-950)' : 'transparent'),
        fontFamily: 'var(--font-sans)',
        fontSize: 14,
        fontWeight: on ? 600 : 500,
        color: on ? 'var(--text-1)' : 'var(--text-3)',
        cursor: 'pointer',
        display: 'flex',
        gap: 6,
        alignItems: 'center'
      }
    }, t.label || t, t.count != null && /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 12,
        fontWeight: 600,
        padding: '1px 6px',
        background: on ? 'var(--ink-950)' : 'var(--ink-150)',
        color: on ? '#fff' : 'var(--text-2)',
        borderRadius: 2
      }
    }, t.count));
  }));
}
Object.assign(__ds_scope, { Tabs });
})();

export const { Icon, Button, IconButton, Badge, Card, Hash, Stat, StatusBadge, Tag, Dialog, Toast, Tooltip, FlowSteps, Checkbox, Input, Radio, Select, Switch, Tabs } = __ds_scope;
