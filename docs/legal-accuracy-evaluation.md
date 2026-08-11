# 법률 판단 정확도 평가 운영 기준

## 현재 상태

이 저장소의 전문가 골든셋 평가는 `calibration_pending` 상태입니다.

- 전문가 검토 정책: 0개
- 2인 독립 라벨: 0개
- 조정 완료 단위: 0개
- 인증된 precision·recall·F1: 없음
- 성능 배포 게이트: 비활성화

따라서 현재 UI·README·포트폴리오에서 규칙 엔진의 법률 판단 정확도를 퍼센트로 주장해서는 안 됩니다. `tests/fixtures/`의 사례는 개발자가 만든 합성 회귀 테스트이며 전문가 골든셋이나 실제 기업 평가 결과가 아닙니다.

이 체계가 측정하는 것은 자동화된 문서 검토 결과와 전문가의 문서 기반 판단 사이의 일치도입니다. 법원·감독기관의 위법성 판단이나 실제 운영의 적법성을 대신하지 않습니다.

평가 도구는 준비됐지만 실제 전문가 데이터가 없어 아직 검증 전입니다. 전문가 표본이 없으므로 `certified`와 성능 게이트는 계속 비활성 상태입니다. 구현 세부와 재현 조건은 아래 기술 계약에 기록합니다.

## 일반인이 이해하기 쉬운 평가 기준

법률 판단 성능은 아래 질문을 모두 통과해야 공개합니다.

1. **전문가 판단이 일치하는가:** 전문가 2명이 서로의 답과 시스템 결과를 보지 않고 검토했을 때 같은 결론에 도달하는지 봅니다.
2. **사례가 충분한가:** 한 회사나 업종에 치우치지 않은 실제 처리방침을 충분히 평가했는지 봅니다.
3. **근거가 정확한가:** 시스템이 지적한 원문 문구와 법적 근거가 실제 판단 이유를 뒷받침하는지 봅니다.
4. **중요한 문제를 놓치지 않는가:** 위험도가 높은 누락이나 불명확한 내용을 제대로 찾는지 봅니다.
5. **과하게 경고하지 않는가:** 문제가 아닌 내용을 `누락 가능성 높음`으로 잘못 표시하지 않는지 봅니다.
6. **우연히 좋아 보이는 결과가 아닌가:** 표본 오차를 감안해 가장 보수적으로 보더라도 기준을 넘어야 통과시킵니다.

전문가 평가 전인 현재 이 기준은 정확도 숫자를 만들기 위한 것이 아니라, 근거 없는 숫자가 공개되는 일을 막고 향후 평가를 같은 조건으로 재현하기 위한 안전장치입니다. 아래부터는 개발자와 검토자를 위한 상세 계약입니다.

## 처리방침 내용 평가에 참고하는 공식 법적 축

기준일은 2026년 8월 11일입니다. 법령이나 지침이 바뀌면 `legalAsOfDate`, 규칙셋, 라벨 지침과 영향을 받는 골드 라벨을 함께 재검토합니다.

[개인정보 보호법 제30조의2](https://www.law.go.kr/lsLinkProc.do?chrClsCd=010202&datClsCd=010102&gubun=admRul&joNo=0030000002&lsNm=%EA%B0%9C%EC%9D%B8%EC%A0%95%EB%B3%B4+%EB%B3%B4%ED%98%B8%EB%B2%95&mode=10)는 처리방침 평가 축을 다음과 같이 둡니다.

1. 법에 따라 포함해야 할 사항을 적정하게 정했는지
2. 처리방침을 알기 쉽게 작성했는지
3. 정보주체가 쉽게 확인할 수 있는 방법으로 공개했는지

본 평가에서는 이를 각각 `appropriateness`, `readability`, `accessibility`로 기록합니다. [개인정보 처리방침 평가에 관한 고시](https://www.law.go.kr/admRulLsInfoP.do?admRulSeq=2100000236594)는 공식 평가 기준의 세부 축으로 사용합니다.

개인정보보호위원회는 2026년 4월 개정된 [개인정보 처리방침 작성지침](https://www.pipc.go.kr/np/cop/bbs/selectBoardArticle.do?bbsId=BS217&mCode=D010030020&nttId=12018)을 현재 안내서로 공개하고 있습니다. 이 지침은 라벨 지침과 사례 해석을 보조하지만, 지침상 권고 미충족만으로 위법이나 법정 기재사항 누락을 확정하지 않습니다. 법률·시행령·고시와 작성지침의 역할을 라벨에 구분해 기록합니다.

## 저장 구조와 공개 범위

| 경로 | 역할 | 공개 저장소 포함 |
| --- | --- | --- |
| `data/legal-evaluation/config.json` | 평가 상태, 지표, 최소 표본, 잠정 게이트 | 포함 |
| `data/legal-evaluation/cases.json` | 원문 없는 공개 사례 manifest | 포함 |
| `data/legal-evaluation/evaluation.schema.json` | 사례·검토·조정 데이터 계약 | 포함 |
| `data/legal-evaluation/examples/*.synthetic.json` | 워크플로 설명용 합성 예시 | 포함, 지표 제외 |
| `work/legal-evaluation/corpus/` | 정책 원문·추출문·화면 또는 사실 확인 자료 | 비공개 |
| `work/legal-evaluation/annotations/` | 실제 검토자 독립 라벨 | 비공개 |
| `work/legal-evaluation/adjudications/` | 실제 조정 결과 | 비공개 |

실제 원문과 전문가 라벨은 `work/legal-evaluation/` 아래 또는 접근통제된 외부 저장소에 둡니다. 공개 저장소에는 불투명한 `caseId`, 평가 텍스트 SHA-256, 문서 완전성, 적용 법령 기준일과 지침 버전만 기록합니다. 회사·업종·출처 URL·corpus 참조와 split은 locked test를 동결하고 평가를 마칠 때까지 공개하지 않습니다.

다음 정보는 커밋하지 않습니다.

- 비공개·로그인 후 노출되는 처리방침 원문
- 동의 화면 캡처나 네트워크 로그의 개인정보
- 검토자의 실명·연락처·자격 증빙 원본
- 서비스 운영 과정에서 취득한 비공개 계약·위탁 자료

공개 URL의 정책이라도 전체 사본을 재배포하기보다 비공개 평가 corpus에 보관합니다. 공개 manifest는 문서 존재와 버전 고정에 필요한 불투명 해시만 남기고, 회사·출처·split 통계는 평가가 동결된 뒤 집계 수준으로 공개합니다. 검토자는 가명 ID를 사용합니다.

## 평가 단위와 실행 입력

평가의 기본 단위는 다음의 평면 행입니다.

```text
caseId × evaluationMode × canonicalRuleId
```

- `caseId`: 특정 시점에 수집한 하나의 처리방침 문서
- `evaluationMode`: 문서만 보는 `policyOnly` 또는 검증된 운영 사실을 함께 주는 `contextAssisted`
- `canonicalRuleId`: 여러 출력 변형을 하나로 묶은 안정적인 규칙 ID

예를 들어 `third-party-missing`과 `third-party-fields`는 `third_party.disclosure`로, `third-party-context-conflict`는 `third_party.context_conflict`로 정규화합니다. 공개 계약의 밑줄 표기(`third_party_disclosure`)도 같은 ID의 호환 별칭으로 읽습니다. 구체적인 차이는 `goldLabel`, `severity`, `defectCodes`로 비교합니다.

실제 평가 runner는 `--cases`, `--annotations`, `--adjudications`로 전달한 비공개 사례·독립 라벨·조정본을 위 평면 행으로 정규화합니다. `data/legal-evaluation/cases.json`은 원문이나 골드 라벨을 담는 실행 입력이 아니라 공개 가능한 manifest이며, 빈 공개 manifest는 성능 수치 없이 상태 계약만 검사합니다. 실제 실행 파일의 위치와 필드명이 runner 구현에서 더 구체화되더라도 다음 의미 계약은 유지해야 합니다.

- 한 행은 하나의 사례·모드·canonical rule만 표현
- 미조정 reviewer 라벨을 gold로 사용하지 않음
- 합성 예시는 항상 `synthetic=true`, `eligibleForMetrics=false`
- 원문 해시, 법령 기준일, 규칙셋 버전과 라벨 지침 버전 고정

`span.start`와 `span.end`는 JavaScript 문자열의 UTF-16 code-unit offset으로 고정합니다. 원본 파일 바이너리 해시와 추출·정규화된 평가 텍스트 해시는 서로 다른 필드로 보존해야 합니다.

검토 packet을 만들 때 사용한 `data/legal-runtime-manifest.json`의 정확한 바이트를 SHA-256으로 고정합니다. 이 해시는 reviewer annotation과 adjudication까지 이어지며, 평가 시 로드한 manifest·평가 텍스트·corpus·evaluation ID 중 하나라도 다르면 runner가 실패합니다. 별도 manifest를 쓰는 보호 환경에서는 `accuracy:prepare`와 `accuracy:evaluate` 양쪽에 같은 `--runtime-manifest` 경로를 지정합니다.

## `policyOnly`와 `contextAssisted`

두 모드의 지표는 합산하지 않습니다.

### `policyOnly`

처리방침 원문만 검토합니다. 실제 제3자 제공·위탁·쿠키·국외 이전 여부를 문서로 알 수 없으면 전문가도 추정하지 않고 `factual_verification` 또는 `insufficient_evidence`로 둡니다.

### `contextAssisted`

동의 화면, 회원가입 화면, 검증된 네트워크 관찰 등 출처와 시점이 기록된 사실 자료를 함께 제공합니다. 사실 자료마다 수집 시각, 출처 URL 또는 내부 증거 ID와 SHA-256을 비공개 corpus에 기록합니다. 실제 운영 여부를 `yes`나 `no`로 확정하려면 이 자료가 있어야 합니다. 사실 자료가 없는 검토자의 상식이나 기업에 대한 추정은 골드 라벨로 사용하지 않습니다.

## `fullDocument`와 `partial`

문서 완전성은 누락 판정의 전제입니다.

### `fullDocument`

다음 조건을 모두 만족해야 합니다.

- 현재 시행 중인 처리방침의 전체 본문을 확보
- 표의 행·열과 링크 위임 내용을 평가에 필요한 범위에서 보존
- 추출 결과와 원본 문서의 SHA-256 및 수집 시각 기록
- 잘림·로그인 벽·렌더링 실패가 없음을 확인

`fullDocument`만 전역 누락 규칙의 precision·recall·F1 분모에 포함합니다.

### `partial`

일부 문단, 검색 결과 snippet, 잘린 PDF, 표가 유실된 추출문 등입니다.

- 관찰된 문구의 모호성 또는 근거 grounding은 평가 가능
- 문서 전체에 어떤 항목이 없다는 판정은 불가
- 누락 규칙의 골드는 `insufficient_evidence`
- omission metric에서는 제외
- `partialScope`에 실제 관찰 범위를 기록

부분 문서를 누락의 음성 또는 양성 사례로 사용하면 precision과 recall이 모두 왜곡되므로 금지합니다.

## 라벨

### 적용 여부

- `applicable`: 규칙이 해당 사례에 적용됨
- `notApplicable`: 적용되지 않는다는 근거가 있음
- `unknown`: 문서와 제공된 사실 자료만으로 판단 불가

### 골드 라벨

- `confirmed_disclosure`: 문서상 공개 내용을 확인
- `possible_missing_disclosure`: 적용되는 필수 공개사항의 누락 가능성
- `ambiguity_or_inconsistency`: 모호하거나 문단 간 충돌 가능성
- `factual_verification`: 실제 서비스 동작 확인 필요
- `insufficient_evidence`: 평가 자료 자체가 부족함

`notApplicable`은 적용 여부 필드에 기록하고 성능 분모에서 제외합니다. `insufficient_evidence`도 일반 precision·recall 분모에서 제외하되, 엔진이 이런 사례를 무리하게 고위험으로 올리는지는 guardrail로 측정합니다.

## 근거 계약

근거는 두 종류입니다.

1. `span`: 원문에 존재하는 정확한 인용 범위와 그 문구의 지지 수준
2. `absence_trace`: 누락 판정을 위해 확인한 문단과 필수 필드의 재현 가능한 검사 기록

인용문이 원문에 존재하기만 해서는 grounding 통과가 아닙니다. 전문가가 해당 문구가 판정 이유를 직접 뒷받침한다고 확인해야 합니다. 누락 판정에 임의의 주변 문구를 붙이는 대신 `absence_trace`를 사용합니다.

## 2인 독립 검토와 조정

1. 법령 기준일, canonical rule catalog, 라벨 지침 버전을 동결합니다.
2. 20~30개 calibration 사례를 두 검토자가 독립적으로 라벨링합니다.
3. 검토자는 규칙 엔진의 출력, 다른 검토자의 라벨과 최종 점수를 보지 않습니다.
4. 조정 전에 원래 두 라벨을 변경 불가능한 기록으로 보존합니다.
5. 적용 여부·라벨·위험도·근거·법적 근거 중 하나라도 다르면 조정합니다.
6. 합의되지 않은 고위험 또는 법적 근거 불일치는 제3 전문가가 조정합니다.
7. `adjudicated` 결과만 골드셋과 성능 계산에 사용합니다.
8. calibration 사례는 지침을 다듬는 용도이며 최종 성능에서 제외합니다.

두 독립 라벨이 모든 필드에서 같아도 `agreementConfirmation` 기록을 만들어 두 원본 annotation ID와 최종 결정을 연결합니다. 실제 불일치가 있는 경우에만 `disagreementTypes`를 채우고 `jointConsensus` 또는 `thirdExpert`를 사용합니다.

검토자는 가능하면 규칙 개발에 직접 참여하지 않은 사람으로 구성합니다. 평가 방법, 테스트셋과 불확실성을 문서화하고 독립 평가자를 참여시키는 원칙은 [NIST AI RMF Core의 Measure 영역](https://airc.nist.gov/airmf-resources/airmf/5-sec-core/)과도 일치합니다.

## 합의도

runner는 조정 전 구조화 라벨을 보존하고 다음 항목의 합의도를 각각 계산합니다. 정확히 2명의 독립·블라인드 검토가 연결되지 않거나 검토 쌍이 하나라도 빠지면 인증에 사용할 수 없습니다.

- 적용 여부·최종 판단 종류: 원시 일치율과 Cohen's κ
- 위험도: 선형 가중 Cohen's κ와 `na` 불일치 수
- 사실 확인 필요 여부: 원시 일치율과 Cohen's κ
- 결함 코드·법적 근거: 빈 집합을 분리한 Jaccard와 pooled set-F1
- 근거 문구: 구조 일치율, 지지 수준과 최적 1:1 span overlap F1

희귀 라벨에서는 κ가 낮거나 계산 불가능할 수 있으므로 라벨 분포, support와 원시 일치율을 항상 함께 공개합니다. 내부 잠정 기준은 κ 0.80 이상입니다. 0.67~0.79이면 라벨 지침을 재검토하고 0.67 미만이면 골든셋 인증을 중지합니다. 이는 내부 운영 기준이지 보편적인 법칙이 아닙니다. Cohen's κ의 원전은 [Cohen, 1960](https://doi.org/10.1177/001316446002000104)입니다.

## 성능 지표

### 1. Rule-balanced actionable macro F1

`possible_missing_disclosure`, `ambiguity_or_inconsistency`, `factual_verification`을 조치가 필요한 양성으로 보고 `confirmed_disclosure`를 음성으로 봅니다. canonical rule별 F1을 계산한 뒤 비가중 평균합니다.

```text
precision = TP / (TP + FP)
recall    = TP / (TP + FN)
F1        = 2 × precision × recall / (precision + recall)
```

macro 평균은 빈도가 낮은 조건부 규칙이 필수 항목 다수에 묻히지 않게 합니다. micro 지표와 정확한 finding type별 macro F1도 진단용으로 함께 냅니다. 정의와 평균 방식은 [scikit-learn 공식 지표 문서](https://scikit-learn.org/stable/modules/generated/sklearn.metrics.precision_recall_fscore_support.html)를 따릅니다.

### 2. High-risk recall strict

골드가 `high`인 사례에서 같은 canonical rule을 엔진도 `high`로 찾은 비율입니다. `medium`으로 찾으면 `high_risk_actionable_recall`에는 포함할 수 있지만 strict 지표에서는 FN입니다.

### 3. Strict evidence grounding rate

모든 actionable 출력 중 유효한 `span` 또는 `absence_trace`가 있고 전문가가 `direct`로 확인한 비율입니다. 근거가 없는 출력을 분모에서 제외하지 않습니다.

### Guardrail

- `possible_missing_precision`: 근거 없는 기업 누락 지적을 억제
- `unsafe_high_escalation_rate`: 골드가 confirmed·not applicable·insufficient인데 엔진이 high를 낸 비율

비율 지표에는 95% Wilson 구간을 진단값으로 기록하고, 성능 인증에는 고정 seed의 회사 단위 clustered bootstrap 95% 구간을 사용합니다. 같은 회사의 여러 규칙 행을 서로 독립이라고 가정하지 않습니다. 최소 지표는 신뢰구간 하한이 기준 이상이어야 하고, 위험 과대평가처럼 작아야 하는 지표는 신뢰구간 상한이 기준 이하여야 합니다. 회사 cluster가 30개보다 적거나 10,000회 중 유효 반복이 99% 미만이면 수치가 좋아도 인증하지 않습니다.

## 최소 표본과 split

- 전문가 검토 정책 최소 100개, 권장 150~200개
- 서로 다른 회사 그룹 최소 30개
- 최소 5개 업종
- calibration 20~30개는 최종 성능에서 제외
- 회사 단위 locked test 최소 30%
- 각 평가 모드의 locked test에 서로 다른 회사 최소 30개
- 규칙별 recall 공개: gold positive 20건 이상
- 규칙별 precision 공개: predicted positive 20건 이상
- 규칙별 F1 공개: positive 20건과 negative 20건 이상
- high-risk recall 인증: high gold 50건 이상, 5개 이상 규칙군
- 한 고위험 규칙군이 high 표본의 40%를 초과하지 않음

같은 회사, 계열 서비스, 동일 문서의 이전 버전과 동일 처리방침을 공유하는 도메인은 하나의 `companyId`로 묶고 한 split에만 둡니다. 문장 일부를 고친 파생 사례도 원본과 다른 split에 배치하지 않습니다.

분모가 최소 조건을 만족하지 않으면 0 또는 100%로 표시하지 않고 `insufficient_support`와 `null`을 반환합니다.

## 잠정 배포 게이트

`config.json`의 임계치는 아직 실제 전문가 분포로 검증되지 않은 `provisional_unvalidated` 값입니다.

| 지표 | 잠정 기준 |
| --- | ---: |
| Rule-balanced actionable macro F1 | 95% 하한 0.85 이상 |
| High-risk recall strict | 95% 하한 0.90 이상 |
| Strict evidence grounding | 95% 하한 0.95 이상 |
| Possible-missing precision | 95% 하한 0.90 이상 |
| Legal-basis precision·recall | 각각 95% 하한 0.90 이상 |
| Unsafe high escalation | 관측 0건, Wilson 95% 상한 0.05 이하 |
| 필드별 전문가 합의 | 검토 쌍 100% 완성, 주요 지표 95% 하한 0.80 이상 |

현재는 `active=false`이므로 이 값으로 CI를 차단하지 않습니다. 공개 CI는 빈 manifest, `metrics=null`, 원문 미포함과 상태 일관성만 검사합니다. 다음 조건을 모두 만족하고 보호된 평가 환경에 private locked test를 제공한 뒤 사람의 승인으로만 성능 게이트를 활성화합니다.

1. 최소 표본 충족
2. 두 검토자의 독립 라벨 완료
3. 모든 불일치 조정 완료
4. 회사 단위 locked test 확정
5. 법령 기준일과 규칙셋 버전 일치
6. 실제 baseline과 신뢰구간 검토
7. 필드별 합의도·Wilson 구간·회사 단위 bootstrap 결과 확인

신뢰구간과 필드별 합의도 계산 코드는 구현됐지만, 현재 설정은 `active=false`, `certified=false`입니다. 실제 전문가 데이터, 최소 표본과 사람의 승인 없이 이 플래그를 바꾸거나 배포 게이트를 활성화하면 안 됩니다.

활성화 후에는 고정 하한 미달뿐 아니라 이전 인증 버전 대비 유의한 회귀도 차단합니다. 지표를 개선하기 위해 locked test를 반복 열람하거나 임계치를 사후 변경해서는 안 됩니다.

## 법령 변경 시 재검토

법령 감시가 변경을 발견했다고 기존 골드 라벨을 자동으로 다시 쓰지 않습니다.

1. 변경된 공식 문서와 시행일을 기록
2. 영향을 받는 canonical rule과 사례를 식별
3. 시행 전에는 별도 후보 규칙셋으로 평가
4. 시행일 이후 전문가가 영향 라벨을 재검토
5. 새 ruleset·guideline 버전으로 locked test를 다시 인증

사람 검토가 끝나지 않은 영향 범위는 `factual_verification` 또는 법령 검토 대기 상태로 유지합니다.

## 시작 절차

1. canonical rule catalog와 출력 ID 매핑을 고정합니다.
2. 비공개 corpus에 업종별 `fullDocument` 사례를 수집합니다.
3. 공개 `cases.json`에는 불투명 ID·평가 텍스트 해시·법령 버전 핀만 추가하고 회사·출처·split은 비공개로 유지합니다.
4. `accuracy:prepare`로 검토자별 blind packet을 따로 만들고 2인이 calibration 20~30개를 독립 검토합니다.
5. 완성된 packet은 `accuracy:export-annotations`로 원문·URL·context를 제거한 annotation batch로 변환합니다.
6. 두 원본 annotation ID를 연결한 조정본을 만들고 합의도와 라벨 지침을 재검토합니다.
7. development와 locked test를 회사 단위로 분리합니다.
8. 조정된 flat gold 행만 평가 runner에 제공합니다.
9. 최소 표본 전에는 상태를 계속 `calibration_pending` 또는 `labeling`으로 표시합니다.

```bash
npm run accuracy:prepare -- --reviewer expert-a --cases work/legal-evaluation/cases.json
npm run accuracy:prepare -- --reviewer expert-b --cases work/legal-evaluation/cases.json
npm run accuracy:export-annotations -- --packet work/legal-evaluation/review-expert-a.json
npm run accuracy:export-annotations -- --packet work/legal-evaluation/review-expert-b.json
npm run accuracy:evaluate -- --config data/legal-evaluation/config.json --cases work/legal-evaluation/cases.json --annotations work/legal-evaluation/annotations/expert-a.json,work/legal-evaluation/annotations/expert-b.json --adjudications work/legal-evaluation/adjudications/final.json
```

CLI에서 직접 지정한 상대 경로는 저장소 루트 기준이며, config 파일 안의 `casesFile`·`annotationsFile`·`adjudicationsFile`은 config가 있는 폴더 기준입니다. 검토 packet과 annotation batch는 모두 `work/` 아래의 비공개 산출물이며 커밋하지 않습니다.

전문가가 실제로 검토하지 않은 행에 reviewer ID를 붙이거나 합성 사례를 복사해 정확도 수치를 만드는 것은 금지합니다.
