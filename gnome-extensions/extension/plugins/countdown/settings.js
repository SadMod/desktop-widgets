// settings.js
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import GLib from 'gi://GLib';
import { buildBaseStyleSettings } from '../../shared/settings/settingsBaseStyle.js';

export function buildSettings(config, onConfigChange) {
    const contentGroups = [];
    const appearanceGroups = [];

    // --- Main settings group ---
    const mainGroup = new Adw.PreferencesGroup({ title: 'Main Settings' });

    // Timer title
    const titleRow = new Adw.ActionRow({ title: 'Timer Title' });
    const titleEntry = new Gtk.Entry({ text: config.title || 'Deadline', valign: Gtk.Align.CENTER, hexpand: true });
    titleEntry.connect('changed', () => onConfigChange('title', titleEntry.get_text()));
    titleRow.add_suffix(titleEntry);
    mainGroup.add(titleRow);

    // --- Helper to create spinner with label ---
    function createSpinnerWithLabel(labelText, adjustmentProps, initialValue, widthChars) {
        const box = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 1 });
        const label = new Gtk.Label({ label: labelText });
        box.append(label);
        const adj = new Gtk.Adjustment(adjustmentProps);
        const spinner = new Gtk.SpinButton({ adjustment: adj, numeric: true, width_chars: widthChars });
        spinner.set_value(initialValue);
        box.append(spinner);
        return { box, spinner };
    }

    // Get initial values from config or current time
    let targetDate = config.targetTimestamp ? new Date(config.targetTimestamp * 1000) : new Date();
    if (!config.targetTimestamp) {
        targetDate.setDate(targetDate.getDate() + 1);
        targetDate.setHours(0, 0, 0, 0);
    }

    // --- Time of day (always visible) ---
    const timeRow = new Adw.ActionRow({ title: 'Target Time', subtitle: 'HH:MM:SS' });
    const timeBox = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 2, halign: Gtk.Align.END });

    const hour   = createSpinnerWithLabel('h:', { lower: 0, upper: 23, step_increment: 1 }, targetDate.getHours(), 2);
    const minute = createSpinnerWithLabel('m:', { lower: 0, upper: 59, step_increment: 1 }, targetDate.getMinutes(), 2);
    const second = createSpinnerWithLabel('s:', { lower: 0, upper: 59, step_increment: 1 }, targetDate.getSeconds(), 2);

    timeBox.append(hour.box);
    timeBox.append(minute.box);
    timeBox.append(second.box);
    timeRow.add_suffix(timeBox);
    mainGroup.add(timeRow);

    // --- Full date (day, month, year) - initially hidden, shown when needed ---
    const dateRow = new Adw.ActionRow({ title: 'Target Date' });
    const dateBox = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 2, halign: Gtk.Align.END });

    const day    = createSpinnerWithLabel('d:', { lower: 1, upper: 31, step_increment: 1 }, targetDate.getDate(), 2);
    const month  = createSpinnerWithLabel('M:', { lower: 1, upper: 12, step_increment: 1 }, targetDate.getMonth() + 1, 2);
    const year   = createSpinnerWithLabel('y:', { lower: 2020, upper: 2100, step_increment: 1 }, targetDate.getFullYear(), 4);

    dateBox.append(day.box);
    dateBox.append(month.box);
    dateBox.append(year.box);
    dateRow.add_suffix(dateBox);
    mainGroup.add(dateRow);

    // --- Recurrence settings ---
    const recurringGroup = new Adw.PreferencesGroup({ title: 'Recurrence' });

    // Recurrence switch
    const recurringRow = new Adw.ActionRow({ title: 'Recurring Timer' });
    const recurringSwitch = new Gtk.Switch({ active: config.isRecurring || false, valign: Gtk.Align.CENTER });
    recurringSwitch.connect('notify::active', () => {
        onConfigChange('isRecurring', recurringSwitch.get_active());
        updateVisibility();
    });
    recurringRow.add_suffix(recurringSwitch);
    recurringGroup.add(recurringRow);

    // Recurrence type combo
    const recurrenceTypeRow = new Adw.ActionRow({ title: 'Recurrence Type' });
    const recurrenceTypeCombo = new Gtk.ComboBoxText();
    recurrenceTypeCombo.append('daily', 'Every day');
    recurrenceTypeCombo.append('weekly', 'Every week');
    recurrenceTypeCombo.append('monthly', 'Every month');
    recurrenceTypeCombo.append('custom', 'Every N days');
    recurrenceTypeCombo.set_active_id(config.recurrenceType || 'daily');
    recurrenceTypeCombo.connect('changed', () => {
        onConfigChange('recurrenceType', recurrenceTypeCombo.get_active_id());
        updateVisibility();
    });
    recurrenceTypeRow.add_suffix(recurrenceTypeCombo);
    recurringGroup.add(recurrenceTypeRow);

    // Interval for custom
    const intervalRow = new Adw.ActionRow({ title: 'Interval (days)' });
    const intervalSpin = new Gtk.SpinButton({ adjustment: new Gtk.Adjustment({ lower: 1, upper: 365, step_increment: 1 }), numeric: true });
    intervalSpin.set_value(config.recurrenceInterval || 1);
    intervalSpin.connect('value-changed', () => onConfigChange('recurrenceInterval', intervalSpin.get_value_as_int()));
    intervalRow.add_suffix(intervalSpin);
    recurringGroup.add(intervalRow);

    // Weekly day picker (visible only when recurrence type = weekly)
    const weeklyDayRow = new Adw.ActionRow({ title: 'Day of Week' });
    const weeklyDayCombo = new Gtk.ComboBoxText();
    const daysOfWeek = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    daysOfWeek.forEach((day, idx) => weeklyDayCombo.append(idx.toString(), day));
    weeklyDayCombo.set_active_id((config.weeklyDay || 0).toString());
    weeklyDayCombo.connect('changed', () => {
        onConfigChange('weeklyDay', parseInt(weeklyDayCombo.get_active_id(), 10));
    });
    weeklyDayRow.add_suffix(weeklyDayCombo);
    recurringGroup.add(weeklyDayRow);

    // Monthly day picker (visible only when recurrence type = monthly)
    const monthlyDayRow = new Adw.ActionRow({ title: 'Day of Month' });
    const monthlyDaySpin = new Gtk.SpinButton({ adjustment: new Gtk.Adjustment({ lower: 1, upper: 31, step_increment: 1 }), numeric: true });
    monthlyDaySpin.set_value(config.monthlyDay || 1);
    monthlyDaySpin.connect('value-changed', () => onConfigChange('monthlyDay', monthlyDaySpin.get_value_as_int()));
    monthlyDayRow.add_suffix(monthlyDaySpin);
    recurringGroup.add(monthlyDayRow);

    contentGroups.push(recurringGroup);

    // --- Visibility logic ---
    function updateVisibility() {
        const isRecurring = recurringSwitch.get_active();
        const recType = recurrenceTypeCombo.get_active_id();

        // Date fields (day, month, year) are visible when:
        // - Recurrence is OFF (single timer), OR
        // - Recurrence type is 'monthly' (need day of month, but year/month are fixed? For simplicity we keep them hidden)
        // Actually for monthly, we only need day of month, not year/month, so we show only monthly day picker.
        // So dateRow should be visible only when recurrence is OFF (single date).
        dateRow.set_visible(!isRecurring);

        // Interval row visible only for custom
        intervalRow.set_visible(isRecurring && recType === 'custom');
        // Weekly day row visible only for weekly
        weeklyDayRow.set_visible(isRecurring && recType === 'weekly');
        // Monthly day row visible only for monthly
        monthlyDayRow.set_visible(isRecurring && recType === 'monthly');
    }

    // Initial visibility
    updateVisibility();

    // --- Appearance settings (shared) ---
    let currentStyle = { ...(config.style || {}) };
    const onStyleChange = (key, value) => {
        currentStyle = { ...currentStyle, [key]: value };
        onConfigChange('style', currentStyle);
    };
    appearanceGroups.push(...buildBaseStyleSettings(currentStyle, onStyleChange));

    // Add main group to content (after recurrence group, so order in UI is: title, time, date, then recurrence)
    contentGroups.push(mainGroup);

    // --- Update timestamp when any date/time spinner changes ---
    const updateTimestamp = () => {
        // Use current values from spinners
        const h = hour.spinner.get_value_as_int();
        const min = minute.spinner.get_value_as_int();
        const sec = second.spinner.get_value_as_int();

        let date;
        if (!recurringSwitch.get_active()) {
            // Single timer: use full date
            const d = day.spinner.get_value_as_int();
            const m = month.spinner.get_value_as_int() - 1;
            const y = year.spinner.get_value_as_int();
            date = new Date(y, m, d, h, min, sec, 0);
        } else {
            // Recurring timer: use today's date but with specified time
            const today = new Date();
            date = new Date(today.getFullYear(), today.getMonth(), today.getDate(), h, min, sec, 0);
            // For weekly/monthly, we'll handle in widget logic separately
        }
        const timestamp = Math.floor(date.getTime() / 1000);
        onConfigChange('targetTimestamp', timestamp);
    };

    // Connect all spinners to updateTimestamp
    [hour, minute, second, day, month, year].forEach(item => {
        if (item && item.spinner) {
            item.spinner.connect('value-changed', updateTimestamp);
        }
    });

    return { contentGroups, appearanceGroups };
}