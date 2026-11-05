function ExpandPathVariables(const Value: String): String;
var
  I, J: Integer;
  Name, Expanded: String;
begin
  Result := '';
  I := 1;
  while I <= Length(Value) do begin
    if Value[I] = '%' then begin
      J := I + 1;
      while J <= Length(Value) do begin
        if Value[J] = '%' then Break;
        J := J + 1;
      end;
      if J <= Length(Value) then begin
        Name := Copy(Value, I + 1, J - I - 1);
        Expanded := GetEnv(Name);
        if Expanded <> '' then Result := Result + Expanded
        else Result := Result + Copy(Value, I, J - I + 1);
        I := J + 1;
      end else begin
        Result := Result + Value[I];
        I := I + 1;
      end;
    end else begin
      Result := Result + Value[I];
      I := I + 1;
    end;
  end;
end;

function NormalizedPathEntry(const Value: String): String;
begin
  Result := Trim(RemoveQuotes(Trim(Value)));
  Result := ExpandPathVariables(Result);
  StringChangeEx(Result, '/', '\', True);
  while Length(Result) > 3 do begin
    if Result[Length(Result)] <> '\' then Break;
    Delete(Result, Length(Result), 1);
  end;
  Result := Uppercase(Result);
end;

function PathContainsEntry(const Existing, Entry: String): Boolean;
var
  I, Start: Integer;
  Boundary: Boolean;
  Target: String;
begin
  Result := False;
  Target := NormalizedPathEntry(Entry);
  if Target = '' then Exit;
  Start := 1;
  for I := 1 to Length(Existing) + 1 do begin
    if I > Length(Existing) then Boundary := True
    else Boundary := Existing[I] = ';';
    if Boundary then begin
      if NormalizedPathEntry(Copy(Existing, Start, I - Start)) = Target then begin
        Result := True;
        Exit;
      end;
      Start := I + 1;
    end;
  end;
end;

function AppendPathEntry(const Existing, Entry: String): String;
begin
  Result := Existing;
  if PathContainsEntry(Existing, Entry) then Exit;
  if Existing = '' then Result := Entry
  else if Existing[Length(Existing)] = ';' then Result := Existing + Entry
  else Result := Existing + ';' + Entry;
end;

function RemovePathEntry(const Existing, Entry: String): String;
var
  I, Start: Integer;
  Boundary, HasToken: Boolean;
  Token, Target: String;
begin
  Result := '';
  Start := 1;
  HasToken := False;
  Target := NormalizedPathEntry(Entry);
  for I := 1 to Length(Existing) + 1 do begin
    if I > Length(Existing) then Boundary := True
    else Boundary := Existing[I] = ';';
    if Boundary then begin
      Token := Copy(Existing, Start, I - Start);
      if NormalizedPathEntry(Token) <> Target then begin
        if HasToken then Result := Result + ';';
        Result := Result + Token;
        HasToken := True;
      end;
      Start := I + 1;
    end;
  end;
end;
