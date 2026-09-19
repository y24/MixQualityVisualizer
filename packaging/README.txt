Mix Atlas - Windows版（Python・解析ライブラリ非同梱）

フォルダー全体を、書き込み可能な場所に配置してMixAtlas.exeを起動してください。
利用者側に Python 3.13以上（64-bit、pip/venv付き）または uv が必要です。
Node.jsのインストールは不要です。

初回の「解析環境のセットアップ」でCPU版またはNVIDIA GPU版を選び、
「専用環境を作成」を押してください。uvがあれば優先し、なければPython/pipを使います。
uvのみの場合は対応するPythonもuvが直接取得します。
PyTorch/torchaudioは https://download.pytorch.org から、その他のライブラリは
https://pypi.org から利用者のPCへ直接取得します。独自のエンジンZIPは配布しません。
Python・uvをインストールした直後は、Mix Atlasを再起動してください。

依存関係を準備済みの場合は「準備済みの python.exe を指定」も使えます。
Python 3.13以上 x64、PyTorch/torchaudio 2.8.0、resources/app/requirements-runtime.txt
のバージョンを検証してから利用します。既存環境を自動変更しません。
画面左下の「解析環境」から再設定できます。

専用環境の保存先: %APPDATA%\MixAtlas\engines\venv-...
GPU版は数GBのダウンロードと展開用の空き容量が必要です。
GPU利用には対応するNVIDIAドライバーが必要です。ドライバーはアプリで導入しません。
CUDA Toolkit/cuDNNを個別にダウンロード・展開する必要はありません。
音源分離モデルは初回分離時に公式配布先から自動取得します。
必要な環境・モデルを取得した後はオフラインで解析できます。
失敗時は「再試行」で再セットアップできます。完了済みの選択は検証成功まで維持します。

音源を外部に送信しません。モデル・解析履歴はresources/app/.dataに保存します。
配布元PCの音源・解析履歴・モデルは含めません。合成デモのみを含みます。
EXE単体では動きません。resourcesやDLLを含むフォルダー全体を保持してください。
Program Filesのような書き込み制限のある場所は避けてください。

ElectronのLICENSEとLICENSES.chromium.htmlは配布物に保持しています。
利用者が取得するPython、解析ライブラリ、モデルには、それぞれの利用条件が適用されます。
