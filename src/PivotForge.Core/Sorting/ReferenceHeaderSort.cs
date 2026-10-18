namespace PivotForge.Core.Sorting;

/// <summary>
/// Stable PowerSort for the non-transitive NaN/label comparator used by the
/// Chromium 151 reference. Ordinary finite summaries keep the normal .NET sort.
/// Comparison traversal matters here: replacing this with another stable sort
/// changes results when an empty average falls back to its label.
/// Algorithm reference: V8 array-sort.tq / CPython listsort.txt (PowerSort,
/// balanced minimum runs, binary insertion and galloping merges).
/// </summary>
internal sealed class ReferenceHeaderSort(int[] items, Comparison<int> compare)
{
    private readonly List<Run> _runs = [];
    private int _minGallop = 7;
    private readonly record struct Run(int Start, int Length, int Power = 0);

    public static int[] Sort(IEnumerable<int> source, Comparison<int> compare)
    {
        var result = source.ToArray();
        new ReferenceHeaderSort(result, compare).Sort();
        return result;
    }

    private void Sort()
    {
        var length = items.Length;
        if (length < 16)
        {
            Insert(0, 0, length);
            return;
        }

        var step = length;
        var mask = 0;
        while (step >= 64)
        {
            step >>= 1;
            mask = (mask << 1) | 1;
        }
        var remainder = length & mask;
        var accumulated = 0;
        for (var start = 0; start < length;)
        {
            accumulated += remainder;
            var minimum = step;
            if (accumulated >= mask + 1)
            {
                accumulated -= mask + 1;
                minimum++;
            }

            var end = NaturalRun(start);
            var forced = Math.Max(end, Math.Min(length, start + minimum));
            Insert(start, end, forced);
            var count = forced - start;
            if (_runs.Count > 0)
            {
                var previous = _runs[^1];
                var power = BoundaryPower(previous.Start, previous.Length, count, length);
                while (_runs.Count > 1 && _runs[^2].Power > power)
                {
                    Merge(_runs.Count - 2);
                }
                _runs[^1] = _runs[^1] with { Power = power };
            }
            _runs.Add(new Run(start, count));
            start = forced;
        }

        while (_runs.Count > 1)
        {
            var at = _runs.Count - 2;
            if (at > 0 && _runs[at - 1].Length < _runs[at + 1].Length) at--;
            Merge(at);
        }
    }

    private static int BoundaryPower(int start, int first, int second, int length)
    {
        long left = 2L * start + first;
        long right = left + first + second;
        for (var power = 1; ; power++)
        {
            if (left >= length)
            {
                left -= length;
                right -= length;
            }
            else if (right >= length) return power;
            left *= 2;
            right *= 2;
        }
    }

    private int NaturalRun(int start)
    {
        var end = start + 1;
        if (end == items.Length) return end;
        var descending = compare(items[end], items[start]) < 0;
        end++;
        while (end < items.Length && (descending
                   ? compare(items[end], items[end - 1]) < 0
                   : compare(items[end], items[end - 1]) >= 0)) end++;
        if (descending) Array.Reverse(items, start, end - start);
        return end;
    }

    private void Insert(int start, int sortedEnd, int end)
    {
        for (var index = Math.Max(start + 1, sortedEnd); index < end; index++)
        {
            var value = items[index];
            var left = start;
            var right = index;
            while (left < right)
            {
                var middle = left + (right - left) / 2;
                if (compare(value, items[middle]) < 0) right = middle;
                else left = middle + 1;
            }
            Array.Copy(items, left, items, left + 1, index - left);
            items[left] = value;
        }
    }

    // Exponential search from a hint, then binary search in the resulting range.
    // The right boundary includes equals; the left boundary excludes them.
    private int Boundary(int[] source, int key, int start, int count, int hint, bool right)
    {
        bool Before(int value) => right ? compare(value, key) <= 0 : compare(value, key) < 0;
        var previous = 0;
        var offset = 1;
        int low, high;
        if (Before(source[start + hint]))
        {
            var limit = count - hint;
            while (offset < limit && Before(source[start + hint + offset]))
            {
                previous = offset;
                offset = (int)Math.Min(limit, 2L * offset + 1);
            }
            low = hint + previous + 1;
            high = hint + Math.Min(offset, limit);
        }
        else
        {
            var limit = hint + 1;
            while (offset < limit && !Before(source[start + hint - offset]))
            {
                previous = offset;
                offset = (int)Math.Min(limit, 2L * offset + 1);
            }
            low = hint - Math.Min(offset, limit) + 1;
            high = hint - previous;
        }
        while (low < high)
        {
            var middle = low + (high - low) / 2;
            if (Before(source[start + middle])) low = middle + 1;
            else high = middle;
        }
        return low;
    }

    private void Merge(int index)
    {
        var first = _runs[index];
        var second = _runs[index + 1];
        _runs[index] = first with { Length = first.Length + second.Length };
        _runs.RemoveAt(index + 1);
        var skip = Boundary(items, items[second.Start], first.Start, first.Length, 0, true);
        var start = first.Start + skip;
        var left = first.Length - skip;
        if (left == 0) return;
        var right = Boundary(items, items[start + left - 1], second.Start, second.Length, second.Length - 1, false);
        if (right == 0) return;
        if (left <= right) Forward(start, left, second.Start, right);
        else Backward(start, left, second.Start, right);
    }

    private void Forward(int start, int left, int other, int right)
    {
        var buffer = items.AsSpan(start, left).ToArray();
        var x = 0;
        var y = other;
        var target = start;
        items[target++] = items[y++];
        right--;
        while (left > 1 && right > 0)
        {
            var winsLeft = 0;
            var winsRight = 0;
            while (left > 1 && right > 0)
            {
                if (compare(items[y], buffer[x]) < 0)
                {
                    items[target++] = items[y++];
                    right--;
                    winsRight++;
                    winsLeft = 0;
                }
                else
                {
                    items[target++] = buffer[x++];
                    left--;
                    winsLeft++;
                    winsRight = 0;
                }
                if (winsLeft >= _minGallop || winsRight >= _minGallop) break;
            }
            if (left <= 1 || right == 0) break;
            _minGallop++;
            var first = true;
            while (left > 1 && right > 0 && (first || winsLeft >= 7 || winsRight >= 7))
            {
                first = false;
                _minGallop = Math.Max(1, _minGallop - 1);
                winsLeft = Boundary(buffer, items[y], x, left, 0, true);
                Array.Copy(buffer, x, items, target, winsLeft);
                target += winsLeft;
                x += winsLeft;
                left -= winsLeft;
                if (left <= 1) break;
                items[target++] = items[y++];
                if (--right == 0) break;
                winsRight = Boundary(items, buffer[x], y, right, 0, false);
                Array.Copy(items, y, items, target, winsRight);
                target += winsRight;
                y += winsRight;
                right -= winsRight;
                if (right == 0) break;
                items[target++] = buffer[x++];
                left--;
            }
            if (left > 1 && right > 0) _minGallop++;
        }
        if (left == 1 && right > 0)
        {
            Array.Copy(items, y, items, target, right);
            items[target + right] = buffer[x];
        }
        else Array.Copy(buffer, x, items, target, left);
    }

    private void Backward(int start, int left, int other, int right)
    {
        var buffer = items.AsSpan(other, right).ToArray();
        var x = start + left - 1;
        var y = right - 1;
        var target = other + right - 1;
        items[target--] = items[x--];
        left--;
        while (left > 0 && right > 1)
        {
            var winsLeft = 0;
            var winsRight = 0;
            while (left > 0 && right > 1)
            {
                if (compare(buffer[y], items[x]) < 0)
                {
                    items[target--] = items[x--];
                    left--;
                    winsLeft++;
                    winsRight = 0;
                }
                else
                {
                    items[target--] = buffer[y--];
                    right--;
                    winsRight++;
                    winsLeft = 0;
                }
                if (winsLeft >= _minGallop || winsRight >= _minGallop) break;
            }
            if (left == 0 || right <= 1) break;
            _minGallop++;
            var first = true;
            while (left > 0 && right > 1 && (first || winsLeft >= 7 || winsRight >= 7))
            {
                first = false;
                _minGallop = Math.Max(1, _minGallop - 1);
                winsLeft = left - Boundary(items, buffer[y], start, left, left - 1, true);
                Array.Copy(items, x - winsLeft + 1, items, target - winsLeft + 1, winsLeft);
                target -= winsLeft;
                x -= winsLeft;
                left -= winsLeft;
                if (left == 0) break;
                items[target--] = buffer[y--];
                if (--right <= 1) break;
                winsRight = right - Boundary(buffer, items[x], 0, right, right - 1, false);
                Array.Copy(buffer, y - winsRight + 1, items, target - winsRight + 1, winsRight);
                target -= winsRight;
                y -= winsRight;
                right -= winsRight;
                if (right <= 1) break;
                items[target--] = items[x--];
                left--;
            }
            if (left > 0 && right > 1) _minGallop++;
        }
        if (right == 1 && left > 0)
        {
            Array.Copy(items, x - left + 1, items, target - left + 1, left);
            items[target - left] = buffer[y];
        }
        else Array.Copy(buffer, 0, items, target - right + 1, right);
    }
}
